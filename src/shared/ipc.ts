import type { AppPreferences, HomePreferences } from "./app-preferences";
import { isHomePreferences } from "./app-preferences";
import type { AppSetupSnapshot } from "./app-setup";
import {
  isAssetFolderPath,
  isAssetFolderState,
  type AssetFolderState,
} from "./asset-folders";
import type {
  AgentProviderLoginChallenge,
  AgentProviderModelCatalogSnapshot,
  AgentProviderSetupSnapshot,
} from "./agent-providers";
import {
  isAgentProviderBaseUrl,
  isAgentProviderConnectionId,
  isAgentProviderId,
  isAgentProviderSelectorSelectionSnapshot,
} from "./agent-providers";
import {
  ASSET_NAME_MAX_LENGTH,
  isAssetSnapshotList,
  type AssetChangedEvent,
  type LocalAssetImportMode,
  type AssetSnapshot,
} from "./assets";
import type {
  ExternalLibraryMigrationConflictResolution,
  ExternalLibraryMigrationResult,
  ExternalLibrarySnapshot,
} from "./external-libraries";
import type {
  GenerationTaskEvent,
  GenerationTaskIdRequest,
  GenerationTaskProjectRequest,
  GenerationTaskView,
  StartGenerationTaskRequest,
} from "./generation-tasks";
import {
  isAbsoluteFileSystemPath,
  PROJECT_NAME_MAX_LENGTH,
  type ProjectSnapshot,
} from "./projects";
import type {
  WorkbenchBootstrap,
  WorkbenchCloseRequest,
  WorkbenchCommandRequest,
  WorkbenchCommandResult,
  WorkbenchEvent,
  WorkbenchOpenRequest,
} from "./workbench/protocol";
import type { WorkbenchFacilityEvent } from "./workbench/facilities/facility-event";
import type { AssetAttachment } from "./attachments/contracts";
import type { AssetTarget } from "./workbench/asset-target";
import type { JsonValue } from "./workbench/protocol";
import type {
  ConversationRecord,
  DeleteProjectConversationRequest,
  ProjectConversationProjectRequest,
  SaveProjectConversationRequest,
} from "./project-conversations";
import type {
  ProjectLearningNoteProjectRequest,
  ProjectLearningNoteSnapshot,
  SaveProjectLearningNoteRequest,
} from './project-learning-notes';

export const IPC_CHANNELS = {
  healthCheck: "app:health-check",
  openExternal: "app:open-external",
  getAppPreferences: "settings:get",
  updateHomePreferences: "settings:update-home",
  getAppSetup: "settings:get-app-setup",
  completeExternalLibraryOnboarding:
    "settings:complete-external-library-onboarding",
  completeAgentProviderOnboarding:
    "settings:complete-agent-provider-onboarding",
  getAgentProviderSetup: "agent-provider:get-setup",
  refreshAgentProvider: "agent-provider:refresh",
  agentProviderChanged: "agent-provider:changed",
  startAgentProviderLogin: "agent-provider:start-login",
  cancelAgentProviderLogin: "agent-provider:cancel-login",
  configureAgentProviderApiConnection:
    "agent-provider:configure-api-connection",
  deleteAgentProviderConnection: "agent-provider:delete-connection",
  getAgentProviderModels: "agent-provider:get-models",
  selectAgentProviderForSelector: "agent-provider:select-for-selector",
  listExternalLibraries: "external-library:list",
  refreshExternalLibrary: "external-library:refresh",
  startExternalLibraryInstallation: "external-library:install",
  cancelExternalLibrary: "external-library:cancel",
  removeExternalLibrary: "external-library:remove",
  selectExternalLibrariesDirectory: "external-library:select-directory",
  migrateExternalLibraries: "external-library:migrate",
  externalLibraryChanged: "external-library:changed",
  listProjects: "project:list",
  createProject: "project:create",
  selectProjectWorkspace: "project:select-workspace",
  changeProjectWorkspace: "project:change-workspace",
  openProjectWorkspace: "project:open-workspace",
  renameProject: "project:rename",
  setProjectPinned: "project:set-pinned",
  deleteProject: "project:delete",
  openProject: "project:open",
  closeProject: "project:close",
  listProjectConversations: "project-conversation:list",
  saveProjectConversation: "project-conversation:save",
  deleteProjectConversation: "project-conversation:delete",
  getProjectLearningNote: 'project-learning-note:get',
  saveProjectLearningNote: 'project-learning-note:save',
  selectLocalAssetFiles: "asset:select-local-files",
  addLocalAssets: "asset:add-local-files",
  renameAsset: "asset:rename",
  relinkAsset: "asset:relink",
  deleteAssets: "asset:delete-many",
  refreshAsset: "asset:refresh",
  refreshAllAssets: "asset:refresh-all",
  revealAssetInFolder: "asset:reveal-in-folder",
  assetChanged: "asset:changed",
  listAssetFolders: "asset-folder:list",
  createAssetFolder: "asset-folder:create",
  updateAssetFolder: "asset-folder:update",
  deleteAssetFolder: "asset-folder:delete",
  moveAssetsToFolder: "asset-folder:move-assets",
  listGenerationTasks: "generation-task:list",
  getGenerationTask: "generation-task:get",
  startGenerationTask: "generation-task:start",
  retryGenerationTask: "generation-task:retry",
  cancelGenerationTask: "generation-task:cancel",
  discardGenerationTask: "generation-task:discard",
  generationTaskChanged: "generation-task:changed",
  openWorkbench: "workbench:open",
  commandWorkbench: "workbench:command",
  closeWorkbench: "workbench:close",
  workbenchEvent: "workbench:event",
  workbenchFacilityEvent: "workbench:facility-event",
  listAttachments: "attachment:list",
  createAttachment: "attachment:create",
  readAttachmentContent: "attachment:read-content",
  deleteAttachment: "attachment:delete",
} as const;

export const ASSET_BATCH_MAX_SIZE = 512;

export interface HealthCheckResponse {
  status: "ok";
  appVersion: string;
  platform: NodeJS.Platform;
  timestamp: string;
}

export interface LearningCompanionApi {
  healthCheck: () => Promise<HealthCheckResponse>;
  openExternal: (request: OpenExternalRequest) => Promise<void>;
  getAppPreferences: () => Promise<AppPreferences>;
  updateHomePreferences: (
    request: UpdateHomePreferencesRequest,
  ) => Promise<AppPreferences>;
  getAppSetup: () => Promise<AppSetupSnapshot>;
  completeExternalLibraryOnboarding: () => Promise<AppSetupSnapshot>;
  completeAgentProviderOnboarding: () => Promise<AppSetupSnapshot>;
  getAgentProviderSetup: () => Promise<AgentProviderSetupSnapshot>;
  refreshAgentProvider: (
    request: AgentProviderIdRequest,
  ) => Promise<AgentProviderSetupSnapshot>;
  onAgentProviderSetupChanged: (
    listener: (snapshot: AgentProviderSetupSnapshot) => void,
  ) => () => void;
  startAgentProviderLogin: (
    request: AgentProviderConnectionRequest,
  ) => Promise<AgentProviderLoginChallenge>;
  cancelAgentProviderLogin: (
    request: CancelAgentProviderLoginRequest,
  ) => Promise<void>;
  configureAgentProviderApiConnection: (
    request: ConfigureAgentProviderApiConnectionRequest,
  ) => Promise<AgentProviderSetupSnapshot>;
  deleteAgentProviderConnection: (
    request: AgentProviderConnectionRequest,
  ) => Promise<AgentProviderSetupSnapshot>;
  getAgentProviderModels: (
    request: AgentProviderConnectionRequest,
  ) => Promise<AgentProviderModelCatalogSnapshot>;
  selectAgentProviderForSelector: (
    request: SelectAgentProviderForSelectorRequest,
  ) => Promise<AgentProviderSetupSnapshot>;
  listExternalLibraries: () => Promise<ExternalLibrarySnapshot[]>;
  refreshExternalLibrary: (
    request: ExternalLibraryIdRequest,
  ) => Promise<ExternalLibrarySnapshot>;
  startExternalLibraryInstallation: (
    request: InstallExternalLibraryRequest,
  ) => Promise<ExternalLibrarySnapshot>;
  cancelExternalLibrary: (request: ExternalLibraryIdRequest) => Promise<void>;
  removeExternalLibrary: (
    request: ExternalLibraryIdRequest,
  ) => Promise<ExternalLibrarySnapshot>;
  selectExternalLibrariesDirectory: () => Promise<string | undefined>;
  migrateExternalLibraries: (
    request: MigrateExternalLibrariesRequest,
  ) => Promise<ExternalLibraryMigrationResult>;
  onExternalLibraryChanged: (
    listener: (snapshot: ExternalLibrarySnapshot) => void,
  ) => () => void;
  listProjects: () => Promise<ProjectSnapshot[]>;
  createProject: (request: CreateProjectRequest) => Promise<ProjectSnapshot>;
  selectProjectWorkspace: (
    request: SelectProjectWorkspaceRequest,
  ) => Promise<string | undefined>;
  changeProjectWorkspace: (
    request: ChangeProjectWorkspaceRequest,
  ) => Promise<ProjectSnapshot>;
  openProjectWorkspace: (request: ProjectLifecycleRequest) => Promise<void>;
  renameProject: (request: RenameProjectRequest) => Promise<ProjectSnapshot>;
  setProjectPinned: (
    request: SetProjectPinnedRequest,
  ) => Promise<ProjectSnapshot>;
  deleteProject: (request: DeleteProjectRequest) => Promise<void>;
  openProject: (request: ProjectLifecycleRequest) => Promise<AssetSnapshot[]>;
  closeProject: (request: ProjectLifecycleRequest) => Promise<void>;
  listProjectConversations: (
    request: ProjectConversationProjectRequest,
  ) => Promise<ConversationRecord[]>;
  saveProjectConversation: (
    request: SaveProjectConversationRequest,
  ) => Promise<ConversationRecord[]>;
  deleteProjectConversation: (
    request: DeleteProjectConversationRequest,
  ) => Promise<ConversationRecord[]>;
  getProjectLearningNote: (
    request: ProjectLearningNoteProjectRequest,
  ) => Promise<ProjectLearningNoteSnapshot>;
  saveProjectLearningNote: (
    request: SaveProjectLearningNoteRequest,
  ) => Promise<ProjectLearningNoteSnapshot>;
  selectLocalAssetFiles: (
    request: ProjectLifecycleRequest,
  ) => Promise<string[]>;
  addLocalAssets: (
    request: AddLocalAssetsRequest,
  ) => Promise<AddLocalAssetsResult>;
  renameAsset: (request: RenameAssetRequest) => Promise<AssetSnapshot>;
  relinkAsset: (request: RelinkAssetRequest) => Promise<AssetSnapshot>;
  deleteAssets: (
    request: DeleteAssetsRequest,
  ) => Promise<DeleteAssetsResult>;
  refreshAsset: (request: AssetIdRequest) => Promise<AssetSnapshot>;
  refreshAllAssets: (
    request: ProjectLifecycleRequest,
  ) => Promise<AssetSnapshot[]>;
  revealAssetInFolder: (request: AssetIdRequest) => Promise<void>;
  onAssetChanged: (
    listener: (event: AssetChangedEvent) => void,
  ) => () => void;
  listAssetFolders: (
    request: ProjectLifecycleRequest,
  ) => Promise<AssetFolderState>;
  createAssetFolder: (
    request: CreateAssetFolderRequest,
  ) => Promise<AssetFolderState>;
  updateAssetFolder: (
    request: UpdateAssetFolderRequest,
  ) => Promise<AssetFolderState>;
  deleteAssetFolder: (
    request: DeleteAssetFolderRequest,
  ) => Promise<DeleteAssetFolderResult>;
  moveAssetsToFolder: (
    request: MoveAssetsToFolderRequest,
  ) => Promise<AssetFolderState>;
  listGenerationTasks: (
    request: GenerationTaskProjectRequest,
  ) => Promise<GenerationTaskView[]>;
  getGenerationTask: (
    request: GenerationTaskIdRequest,
  ) => Promise<GenerationTaskView | undefined>;
  startGenerationTask: (
    request: StartGenerationTaskRequest,
  ) => Promise<GenerationTaskView>;
  retryGenerationTask: (
    request: GenerationTaskIdRequest,
  ) => Promise<GenerationTaskView>;
  cancelGenerationTask: (
    request: GenerationTaskIdRequest,
  ) => Promise<void>;
  discardGenerationTask: (
    request: GenerationTaskIdRequest,
  ) => Promise<void>;
  onGenerationTaskChanged: (
    listener: (event: GenerationTaskEvent) => void,
  ) => () => void;
  openWorkbench: (request: WorkbenchOpenRequest) => Promise<WorkbenchBootstrap>;
  commandWorkbench: (
    request: WorkbenchCommandRequest,
  ) => Promise<WorkbenchCommandResult>;
  onWorkbenchEvent: (
    listener: (event: WorkbenchEvent) => void,
  ) => () => void;
  closeWorkbench: (request: WorkbenchCloseRequest) => Promise<void>;
  onWorkbenchFacilityEvent: (
    listener: (event: WorkbenchFacilityEvent) => void,
  ) => () => void;
  listAttachments: (request: {
    projectId: string;
    assetId: string;
  }) => Promise<AssetAttachment[]>;
  createAttachment: (request: {
    projectId: string;
    assetId: string;
    typeId: string;
    typeVersion: number;
    target: AssetTarget;
    metadata: JsonValue;
    body?: JsonValue;
  }) => Promise<AssetAttachment>;
  readAttachmentContent: (request: {
    projectId: string;
    attachmentId: string;
  }) => Promise<JsonValue>;
  deleteAttachment: (request: {
    projectId: string;
    attachmentId: string;
  }) => Promise<void>;
  getPathForFile: (file: File) => string;
}

export interface CreateProjectRequest {
  name: string;
  workspacePath?: string;
}

export interface SelectProjectWorkspaceRequest {
  projectId?: string;
}

export interface ChangeProjectWorkspaceRequest {
  projectId: string;
  workspacePath: string;
}

export interface OpenExternalRequest {
  url: string;
}

export interface AgentProviderIdRequest {
  providerId: string;
}

export interface AgentProviderConnectionRequest
  extends AgentProviderIdRequest {
  connectionId: string;
}

export interface CancelAgentProviderLoginRequest
  extends AgentProviderConnectionRequest {
  loginId: string;
}

export interface ConfigureAgentProviderApiConnectionRequest {
  providerId: string;
  connectionId?: string;
  displayName: string;
  baseUrl: string;
  apiKey?: string;
}

export interface SelectAgentProviderForSelectorRequest {
  selectorId: string;
  providerId: string;
  connectionId: string;
  modelId: string | null;
  reasoningEffort: string | null;
}

export interface RenameProjectRequest {
  id: string;
  name: string;
}

export interface SetProjectPinnedRequest {
  id: string;
  pinned: boolean;
}

export interface DeleteProjectRequest {
  id: string;
}

export interface ProjectLifecycleRequest {
  projectId: string;
}

export interface AddLocalAssetsRequest {
  projectId: string;
  paths: string[];
  mode?: LocalAssetImportMode;
  folderPath?: string;
}

export interface AddLocalAssetFailure {
  path: string;
  message: string;
}

export interface AddLocalAssetsResult {
  added: AssetSnapshot[];
  failed: AddLocalAssetFailure[];
  assets: AssetSnapshot[];
}

export interface RenameAssetRequest {
  assetId: string;
  name: string;
}

export interface RelinkAssetRequest {
  assetId: string;
  path: string;
}

export interface DeleteAssetsRequest {
  projectId: string;
  assetIds: string[];
}

export interface DeleteAssetFailure {
  assetId: string;
  message: string;
}

export interface DeleteAssetsResult {
  deletedAssetIds: string[];
  failed: DeleteAssetFailure[];
  assets: AssetSnapshot[];
}

export interface CreateAssetFolderRequest {
  projectId: string;
  path: string;
}

export interface UpdateAssetFolderRequest extends CreateAssetFolderRequest {
  nextPath: string;
}

export type DeleteAssetFolderRequest = CreateAssetFolderRequest;

export interface MoveAssetsToFolderRequest {
  projectId: string;
  assetIds: string[];
  folderPath: string | null;
}

export interface DeleteAssetFolderResult extends DeleteAssetsResult {
  folderState: AssetFolderState;
}

export interface AssetIdRequest {
  assetId: string;
}

export interface ExternalLibraryIdRequest {
  libraryId: string;
}

export interface InstallExternalLibraryRequest
  extends ExternalLibraryIdRequest {
  variantId?: string;
}

export interface MigrateExternalLibrariesRequest {
  targetPath: string;
  conflictResolution?: ExternalLibraryMigrationConflictResolution;
}

export type UpdateHomePreferencesRequest = HomePreferences;

export function createHealthCheckResponse(
  appVersion: string,
  platform: NodeJS.Platform,
  now = new Date(),
): HealthCheckResponse {
  return {
    status: "ok",
    appVersion,
    platform,
    timestamp: now.toISOString(),
  };
}

export function isHealthCheckResponse(
  value: unknown,
): value is HealthCheckResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<HealthCheckResponse>;

  return (
    candidate.status === "ok" &&
    typeof candidate.appVersion === "string" &&
    typeof candidate.platform === "string" &&
    typeof candidate.timestamp === "string" &&
    !Number.isNaN(Date.parse(candidate.timestamp))
  );
}

export function isOpenExternalRequest(
  value: unknown,
): value is OpenExternalRequest {
  if (
    !isRecord(value) ||
    typeof value.url !== "string" ||
    value.url.length === 0 ||
    value.url.length > 8_192 ||
    value.url !== value.url.trim()
  ) {
    return false;
  }

  try {
    const url = new URL(value.url);

    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.username.length === 0 &&
      url.password.length === 0
    );
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isRequiredText(value: unknown, maxLength?: number): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    (maxLength === undefined || [...value].length <= maxLength)
  );
}

export function isCreateProjectRequest(
  value: unknown,
): value is CreateProjectRequest {
  return (
    isRecord(value) &&
    isRequiredText(value.name, PROJECT_NAME_MAX_LENGTH) &&
    (value.workspacePath === undefined ||
      isAbsoluteFileSystemPath(value.workspacePath))
  );
}

export function isSelectProjectWorkspaceRequest(
  value: unknown,
): value is SelectProjectWorkspaceRequest {
  return (
    isRecord(value) &&
    (value.projectId === undefined || isRequiredText(value.projectId))
  );
}

export function isChangeProjectWorkspaceRequest(
  value: unknown,
): value is ChangeProjectWorkspaceRequest {
  return (
    isRecord(value) &&
    isRequiredText(value.projectId) &&
    isAbsoluteFileSystemPath(value.workspacePath)
  );
}

export function isRenameProjectRequest(
  value: unknown,
): value is RenameProjectRequest {
  return (
    isRecord(value) &&
    isRequiredText(value.id) &&
    isRequiredText(value.name, PROJECT_NAME_MAX_LENGTH)
  );
}

export function isSetProjectPinnedRequest(
  value: unknown,
): value is SetProjectPinnedRequest {
  return (
    isRecord(value) &&
    isRequiredText(value.id) &&
    typeof value.pinned === "boolean"
  );
}

export function isDeleteProjectRequest(
  value: unknown,
): value is DeleteProjectRequest {
  return isRecord(value) && isRequiredText(value.id);
}

export function isProjectLifecycleRequest(
  value: unknown,
): value is ProjectLifecycleRequest {
  return isRecord(value) && isRequiredText(value.projectId);
}

export function isAddLocalAssetsRequest(
  value: unknown,
): value is AddLocalAssetsRequest {
  return (
    isRecord(value) &&
    isRequiredText(value.projectId) &&
    Array.isArray(value.paths) &&
    value.paths.length > 0 &&
    value.paths.length <= ASSET_BATCH_MAX_SIZE &&
    value.paths.every((path) => isRequiredText(path)) &&
    (value.mode === undefined || value.mode === "copy" || value.mode === "link") &&
    (value.folderPath === undefined || isAssetFolderPath(value.folderPath))
  );
}

export function isCreateAssetFolderRequest(
  value: unknown,
): value is CreateAssetFolderRequest {
  return (
    isRecord(value) &&
    isRequiredText(value.projectId) &&
    isAssetFolderPath(value.path)
  );
}

export function isUpdateAssetFolderRequest(
  value: unknown,
): value is UpdateAssetFolderRequest {
  return (
    isRecord(value) &&
    isCreateAssetFolderRequest(value) &&
    isAssetFolderPath(value.nextPath)
  );
}

export function isMoveAssetsToFolderRequest(
  value: unknown,
): value is MoveAssetsToFolderRequest {
  if (
    !isRecord(value) ||
    !isRequiredText(value.projectId) ||
    !Array.isArray(value.assetIds) ||
    value.assetIds.length === 0 ||
    value.assetIds.length > ASSET_BATCH_MAX_SIZE ||
    !value.assetIds.every((assetId) => isRequiredText(assetId)) ||
    !(value.folderPath === null || isAssetFolderPath(value.folderPath))
  ) {
    return false;
  }

  return new Set(value.assetIds).size === value.assetIds.length;
}

export function isAddLocalAssetsResult(
  value: unknown,
): value is AddLocalAssetsResult {
  if (
    !isRecord(value) ||
    !isAssetSnapshotList(value.added) ||
    !isAssetSnapshotList(value.assets) ||
    !Array.isArray(value.failed) ||
    !value.failed.every(
      (failure) =>
        isRecord(failure) &&
        isRequiredText(failure.path) &&
        isRequiredText(failure.message),
    )
  ) {
    return false;
  }

  const currentAssetIds = new Set(value.assets.map((asset) => asset.id));

  return value.added.every((asset) => currentAssetIds.has(asset.id));
}

export function isRenameAssetRequest(
  value: unknown,
): value is RenameAssetRequest {
  return (
    isRecord(value) &&
    isRequiredText(value.assetId) &&
    isRequiredText(value.name, ASSET_NAME_MAX_LENGTH)
  );
}

export function isRelinkAssetRequest(
  value: unknown,
): value is RelinkAssetRequest {
  return (
    isRecord(value) &&
    isRequiredText(value.assetId) &&
    isRequiredText(value.path)
  );
}

export function isAgentProviderIdRequest(
  value: unknown,
): value is AgentProviderIdRequest {
  return isRecord(value) && isAgentProviderId(value.providerId);
}

export function isAgentProviderConnectionRequest(
  value: unknown,
): value is AgentProviderConnectionRequest {
  return (
    isRecord(value) &&
    isAgentProviderId(value.providerId) &&
    isAgentProviderConnectionId(value.connectionId)
  );
}

export function isCancelAgentProviderLoginRequest(
  value: unknown,
): value is CancelAgentProviderLoginRequest {
  return (
    isRecord(value) &&
    isAgentProviderId(value.providerId) &&
    isAgentProviderConnectionId(value.connectionId) &&
    isRequiredText(value.loginId, 256)
  );
}

export function isConfigureAgentProviderApiConnectionRequest(
  value: unknown,
): value is ConfigureAgentProviderApiConnectionRequest {
  return (
    isRecord(value) &&
    isAgentProviderId(value.providerId) &&
    (value.connectionId === undefined ||
      isAgentProviderConnectionId(value.connectionId)) &&
    isRequiredText(value.displayName, 128) &&
    isAgentProviderBaseUrl(value.baseUrl) &&
    (value.apiKey === undefined || isRequiredText(value.apiKey, 8_192))
  );
}

export function isSelectAgentProviderForSelectorRequest(
  value: unknown,
): value is SelectAgentProviderForSelectorRequest {
  return isAgentProviderSelectorSelectionSnapshot(value);
}

export function isDeleteAssetsRequest(
  value: unknown,
): value is DeleteAssetsRequest {
  if (
    !isRecord(value) ||
    !isRequiredText(value.projectId) ||
    !Array.isArray(value.assetIds) ||
    value.assetIds.length === 0 ||
    value.assetIds.length > ASSET_BATCH_MAX_SIZE ||
    !value.assetIds.every((assetId) => isRequiredText(assetId))
  ) {
    return false;
  }

  return new Set(value.assetIds).size === value.assetIds.length;
}

export function isDeleteAssetsResult(
  value: unknown,
): value is DeleteAssetsResult {
  if (
    !isRecord(value) ||
    !Array.isArray(value.deletedAssetIds) ||
    !value.deletedAssetIds.every((assetId) =>
      isRequiredText(assetId),
    ) ||
    !Array.isArray(value.failed) ||
    !value.failed.every(
      (failure) =>
        isRecord(failure) &&
        isRequiredText(failure.assetId) &&
        isRequiredText(failure.message),
    ) ||
    !isAssetSnapshotList(value.assets)
  ) {
    return false;
  }

  const deletedAssetIds = new Set(value.deletedAssetIds);
  const failedAssetIds = new Set(
    value.failed.map((failure) => failure.assetId),
  );

  return (
    deletedAssetIds.size === value.deletedAssetIds.length &&
    failedAssetIds.size === value.failed.length &&
    [...deletedAssetIds].every(
      (assetId) => !failedAssetIds.has(assetId),
    ) &&
    value.assets.every((asset) => !deletedAssetIds.has(asset.id))
  );
}

export function isDeleteAssetFolderResult(
  value: unknown,
): value is DeleteAssetFolderResult {
  return (
    isDeleteAssetsResult(value) &&
    isRecord(value) &&
    isAssetFolderState(value.folderState)
  );
}

export function isAssetIdRequest(value: unknown): value is AssetIdRequest {
  return isRecord(value) && isRequiredText(value.assetId);
}

export function isExternalLibraryIdRequest(
  value: unknown,
): value is ExternalLibraryIdRequest {
  return (
    isRecord(value) &&
    isRequiredText(value.libraryId, 128) &&
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value.libraryId)
  );
}

export function isInstallExternalLibraryRequest(
  value: unknown,
): value is InstallExternalLibraryRequest {
  return (
    isRecord(value) &&
    isRequiredText(value.libraryId, 128) &&
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value.libraryId) &&
    (value.variantId === undefined ||
      (isRequiredText(value.variantId, 128) &&
        /^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value.variantId)))
  );
}

export function isMigrateExternalLibrariesRequest(
  value: unknown,
): value is MigrateExternalLibrariesRequest {
  return (
    isRecord(value) &&
    isAbsoluteFileSystemPath(value.targetPath) &&
    (value.conflictResolution === undefined ||
      value.conflictResolution === "keep-target" ||
      value.conflictResolution === "replace-target")
  );
}

export function isUpdateHomePreferencesRequest(
  value: unknown,
): value is UpdateHomePreferencesRequest {
  return isHomePreferences(value);
}
