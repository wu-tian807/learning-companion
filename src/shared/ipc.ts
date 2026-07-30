import type { AppPreferences, HomePreferences } from './app-preferences';
import { isHomePreferences } from './app-preferences';
import {
  ASSET_NAME_MAX_LENGTH,
  isAssetSnapshotList,
  type LocalAssetImportMode,
  type AssetSnapshot,
} from './assets';
import {
  isAbsoluteFileSystemPath,
  PROJECT_NAME_MAX_LENGTH,
  type ProjectSnapshot,
} from './projects';
import type {
  WorkbenchBootstrap,
  WorkbenchCloseRequest,
  WorkbenchCommandRequest,
  WorkbenchCommandResult,
  WorkbenchOpenRequest,
} from './workbench/protocol';
import type { WorkbenchFacilityEvent } from './workbench/facilities/facility-event';

export const IPC_CHANNELS = {
  healthCheck: 'app:health-check',
  openExternal: 'app:open-external',
  getAppPreferences: 'settings:get',
  updateHomePreferences: 'settings:update-home',
  listProjects: 'project:list',
  createProject: 'project:create',
  selectProjectWorkspace: 'project:select-workspace',
  changeProjectWorkspace: 'project:change-workspace',
  openProjectWorkspace: 'project:open-workspace',
  renameProject: 'project:rename',
  setProjectPinned: 'project:set-pinned',
  deleteProject: 'project:delete',
  openProject: 'project:open',
  closeProject: 'project:close',
  selectLocalAssetFiles: 'asset:select-local-files',
  addLocalAssets: 'asset:add-local-files',
  renameAsset: 'asset:rename',
  relinkAsset: 'asset:relink',
  deleteAsset: 'asset:delete',
  refreshAsset: 'asset:refresh',
  refreshAllAssets: 'asset:refresh-all',
  revealAssetInFolder: 'asset:reveal-in-folder',
  openWorkbench: 'workbench:open',
  commandWorkbench: 'workbench:command',
  closeWorkbench: 'workbench:close',
  workbenchFacilityEvent: 'workbench:facility-event',
} as const;

export const ASSET_BATCH_MAX_SIZE = 512;

export interface HealthCheckResponse {
  status: 'ok';
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
  listProjects: () => Promise<ProjectSnapshot[]>;
  createProject: (request: CreateProjectRequest) => Promise<ProjectSnapshot>;
  selectProjectWorkspace: (
    request: SelectProjectWorkspaceRequest,
  ) => Promise<string | undefined>;
  changeProjectWorkspace: (
    request: ChangeProjectWorkspaceRequest,
  ) => Promise<ProjectSnapshot>;
  openProjectWorkspace: (
    request: ProjectLifecycleRequest,
  ) => Promise<void>;
  renameProject: (request: RenameProjectRequest) => Promise<ProjectSnapshot>;
  setProjectPinned: (request: SetProjectPinnedRequest) => Promise<ProjectSnapshot>;
  deleteProject: (request: DeleteProjectRequest) => Promise<void>;
  openProject: (request: ProjectLifecycleRequest) => Promise<AssetSnapshot[]>;
  closeProject: (request: ProjectLifecycleRequest) => Promise<void>;
  selectLocalAssetFiles: (
    request: ProjectLifecycleRequest,
  ) => Promise<string[]>;
  addLocalAssets: (
    request: AddLocalAssetsRequest,
  ) => Promise<AddLocalAssetsResult>;
  renameAsset: (request: RenameAssetRequest) => Promise<AssetSnapshot>;
  relinkAsset: (request: RelinkAssetRequest) => Promise<AssetSnapshot>;
  deleteAsset: (request: AssetIdRequest) => Promise<void>;
  refreshAsset: (request: AssetIdRequest) => Promise<AssetSnapshot>;
  refreshAllAssets: (
    request: ProjectLifecycleRequest,
  ) => Promise<AssetSnapshot[]>;
  revealAssetInFolder: (request: AssetIdRequest) => Promise<void>;
  openWorkbench: (
    request: WorkbenchOpenRequest,
  ) => Promise<WorkbenchBootstrap>;
  commandWorkbench: (
    request: WorkbenchCommandRequest,
  ) => Promise<WorkbenchCommandResult>;
  closeWorkbench: (request: WorkbenchCloseRequest) => Promise<void>;
  onWorkbenchFacilityEvent: (
    listener: (event: WorkbenchFacilityEvent) => void,
  ) => () => void;
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

export interface AssetIdRequest {
  assetId: string;
}

export type UpdateHomePreferencesRequest = HomePreferences;

export function createHealthCheckResponse(
  appVersion: string,
  platform: NodeJS.Platform,
  now = new Date(),
): HealthCheckResponse {
  return {
    status: 'ok',
    appVersion,
    platform,
    timestamp: now.toISOString(),
  };
}

export function isHealthCheckResponse(value: unknown): value is HealthCheckResponse {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Partial<HealthCheckResponse>;

  return (
    candidate.status === 'ok' &&
    typeof candidate.appVersion === 'string' &&
    typeof candidate.platform === 'string' &&
    typeof candidate.timestamp === 'string' &&
    !Number.isNaN(Date.parse(candidate.timestamp))
  );
}

export function isOpenExternalRequest(
  value: unknown,
): value is OpenExternalRequest {
  if (
    !isRecord(value) ||
    typeof value.url !== 'string' ||
    value.url.length === 0 ||
    value.url.length > 8_192 ||
    value.url !== value.url.trim()
  ) {
    return false;
  }

  try {
    const url = new URL(value.url);

    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.username.length === 0 &&
      url.password.length === 0
    );
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isRequiredText(value: unknown, maxLength?: number): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    (maxLength === undefined || [...value].length <= maxLength)
  );
}

export function isCreateProjectRequest(value: unknown): value is CreateProjectRequest {
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

export function isRenameProjectRequest(value: unknown): value is RenameProjectRequest {
  return (
    isRecord(value) &&
    isRequiredText(value.id) &&
    isRequiredText(value.name, PROJECT_NAME_MAX_LENGTH)
  );
}

export function isSetProjectPinnedRequest(
  value: unknown,
): value is SetProjectPinnedRequest {
  return isRecord(value) && isRequiredText(value.id) && typeof value.pinned === 'boolean';
}

export function isDeleteProjectRequest(value: unknown): value is DeleteProjectRequest {
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
    (value.mode === undefined ||
      value.mode === 'copy' ||
      value.mode === 'link')
  );
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

  const currentAssetIds = new Set(
    value.assets.map((asset) => asset.id),
  );

  return value.added.every((asset) =>
    currentAssetIds.has(asset.id),
  );
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

export function isAssetIdRequest(value: unknown): value is AssetIdRequest {
  return isRecord(value) && isRequiredText(value.assetId);
}

export function isUpdateHomePreferencesRequest(
  value: unknown,
): value is UpdateHomePreferencesRequest {
  return isHomePreferences(value);
}
