import type { AppPreferences, HomePreferences } from './app-preferences';
import { isHomePreferences } from './app-preferences';

export const IPC_CHANNELS = {
  healthCheck: 'app:health-check',
  getAppPreferences: 'settings:get',
  updateHomePreferences: 'settings:update-home',
  listProjects: 'project:list',
  createProject: 'project:create',
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
} as const;

export const PROJECT_NAME_MAX_LENGTH = 80;
export const PROJECT_ICON_MAX_CODE_POINTS = 8;
export const ASSET_NAME_MAX_LENGTH = 160;
export const ASSET_BATCH_MAX_SIZE = 512;

export interface HealthCheckResponse {
  status: 'ok';
  appVersion: string;
  platform: NodeJS.Platform;
  timestamp: string;
}

export interface LearningCompanionApi {
  healthCheck: () => Promise<HealthCheckResponse>;
  getAppPreferences: () => Promise<AppPreferences>;
  updateHomePreferences: (
    request: UpdateHomePreferencesRequest,
  ) => Promise<AppPreferences>;
  listProjects: () => Promise<ProjectSummary[]>;
  createProject: (request: CreateProjectRequest) => Promise<ProjectSummary>;
  renameProject: (request: RenameProjectRequest) => Promise<ProjectSummary>;
  setProjectPinned: (request: SetProjectPinnedRequest) => Promise<ProjectSummary>;
  deleteProject: (request: DeleteProjectRequest) => Promise<void>;
  openProject: (request: ProjectLifecycleRequest) => Promise<AssetSummary[]>;
  closeProject: (request: ProjectLifecycleRequest) => Promise<void>;
  selectLocalAssetFiles: () => Promise<string[]>;
  addLocalAssets: (
    request: AddLocalAssetsRequest,
  ) => Promise<AddLocalAssetsResult>;
  renameAsset: (request: RenameAssetRequest) => Promise<AssetSummary>;
  relinkAsset: (request: RelinkAssetRequest) => Promise<AssetSummary>;
  deleteAsset: (request: AssetIdRequest) => Promise<void>;
  refreshAsset: (request: AssetIdRequest) => Promise<AssetSummary>;
  getPathForFile: (file: File) => string;
}

export interface ProjectSummary {
  id: string;
  name: string;
  icon: string;
  createdTime: string;
  assetCount: number;
  pinned: boolean;
}

export interface CreateProjectRequest {
  name: string;
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

export type AssetAvailability =
  | 'available'
  | 'missing'
  | 'inaccessible'
  | 'invalid';

export interface AssetSummary {
  id: string;
  projectId: string;
  name: string;
  mediaType: string;
  contentLocator: {
    kind: 'local-file';
    path: string;
    availability: AssetAvailability;
    checkedTime: string;
  };
  createdTime: string;
  lastUsedTime: string;
}

export interface AddLocalAssetsRequest {
  paths: string[];
}

export interface AddLocalAssetFailure {
  path: string;
  message: string;
}

export interface AddLocalAssetsResult {
  added: AssetSummary[];
  failed: AddLocalAssetFailure[];
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

export function isProjectSummary(value: unknown): value is ProjectSummary {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Partial<ProjectSummary>;

  return (
    typeof candidate.id === 'string' &&
    candidate.id.length > 0 &&
    typeof candidate.name === 'string' &&
    candidate.name.length > 0 &&
    typeof candidate.icon === 'string' &&
    candidate.icon.length > 0 &&
    typeof candidate.createdTime === 'string' &&
    !Number.isNaN(Date.parse(candidate.createdTime)) &&
    typeof candidate.assetCount === 'number' &&
    Number.isSafeInteger(candidate.assetCount) &&
    candidate.assetCount >= 0 &&
    typeof candidate.pinned === 'boolean'
  );
}

export function isProjectSummaryList(value: unknown): value is ProjectSummary[] {
  return Array.isArray(value) && value.every(isProjectSummary);
}

export function isAssetSummary(value: unknown): value is AssetSummary {
  if (!isRecord(value)) {
    return false;
  }

  const locator = value.contentLocator;

  return (
    isRequiredText(value.id) &&
    isRequiredText(value.projectId) &&
    isRequiredText(value.name, ASSET_NAME_MAX_LENGTH) &&
    isRequiredText(value.mediaType) &&
    isRecord(locator) &&
    locator.kind === 'local-file' &&
    isRequiredText(locator.path) &&
    ['available', 'missing', 'inaccessible', 'invalid'].includes(
      locator.availability as string,
    ) &&
    typeof locator.checkedTime === 'string' &&
    !Number.isNaN(Date.parse(locator.checkedTime)) &&
    typeof value.createdTime === 'string' &&
    !Number.isNaN(Date.parse(value.createdTime)) &&
    typeof value.lastUsedTime === 'string' &&
    !Number.isNaN(Date.parse(value.lastUsedTime))
  );
}

export function isAssetSummaryList(value: unknown): value is AssetSummary[] {
  return Array.isArray(value) && value.every(isAssetSummary);
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
  return isRecord(value) && isRequiredText(value.name, PROJECT_NAME_MAX_LENGTH);
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
    Array.isArray(value.paths) &&
    value.paths.length > 0 &&
    value.paths.length <= ASSET_BATCH_MAX_SIZE &&
    value.paths.every((path) => isRequiredText(path))
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
