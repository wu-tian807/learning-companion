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
} as const;

export const PROJECT_NAME_MAX_LENGTH = 80;
export const PROJECT_ICON_MAX_CODE_POINTS = 8;

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
}

export interface ProjectSummary {
  id: string;
  name: string;
  icon: string;
  createdTime: string;
  sources: string[];
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
    Array.isArray(candidate.sources) &&
    candidate.sources.every((source) => typeof source === 'string' && source.length > 0) &&
    typeof candidate.pinned === 'boolean'
  );
}

export function isProjectSummaryList(value: unknown): value is ProjectSummary[] {
  return Array.isArray(value) && value.every(isProjectSummary);
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

export function isUpdateHomePreferencesRequest(
  value: unknown,
): value is UpdateHomePreferencesRequest {
  return isHomePreferences(value);
}
