export const IPC_CHANNELS = {
  healthCheck: 'app:health-check',
  listProjects: 'project:list',
} as const;

export interface HealthCheckResponse {
  status: 'ok';
  appVersion: string;
  platform: NodeJS.Platform;
  timestamp: string;
}

export interface LearningCompanionApi {
  healthCheck: () => Promise<HealthCheckResponse>;
  listProjects: () => Promise<ProjectSummary[]>;
}

export interface ProjectSummary {
  id: string;
  name: string;
  icon: string;
  createdTime: string;
  sources: string[];
}

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
    candidate.sources.every((source) => typeof source === 'string' && source.length > 0)
  );
}

export function isProjectSummaryList(value: unknown): value is ProjectSummary[] {
  return Array.isArray(value) && value.every(isProjectSummary);
}
