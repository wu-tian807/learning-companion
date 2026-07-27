export const PROJECT_NAME_MAX_LENGTH = 80;
export const PROJECT_ICON_MAX_CODE_POINTS = 8;

export interface Project {
  readonly id: string;
  readonly name: string;
  readonly icon: string;
  readonly createdTime: number;
  readonly pinned: boolean;
}

export interface ProjectSnapshot extends Project {
  readonly assetCount: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRequiredText(
  value: unknown,
  maxCodePoints?: number,
): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    (maxCodePoints === undefined || [...value].length <= maxCodePoints)
  );
}

export function isUnixMilliseconds(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0
  );
}

export function isProject(value: unknown): value is Project {
  return (
    isRecord(value) &&
    isRequiredText(value.id) &&
    isRequiredText(value.name, PROJECT_NAME_MAX_LENGTH) &&
    isRequiredText(value.icon, PROJECT_ICON_MAX_CODE_POINTS) &&
    isUnixMilliseconds(value.createdTime) &&
    typeof value.pinned === 'boolean'
  );
}

export function isProjectSnapshot(value: unknown): value is ProjectSnapshot {
  return (
    isProject(value) &&
    isRecord(value) &&
    typeof value.assetCount === 'number' &&
    Number.isSafeInteger(value.assetCount) &&
    value.assetCount >= 0
  );
}

export function isProjectSnapshotList(
  value: unknown,
): value is ProjectSnapshot[] {
  return Array.isArray(value) && value.every(isProjectSnapshot);
}

export function cloneProject(project: Project): Project {
  if (!isProject(project)) {
    throw new Error('Project 数据无效');
  }

  return Object.freeze({
    id: project.id.trim(),
    name: project.name.trim(),
    icon: project.icon.trim(),
    createdTime: project.createdTime,
    pinned: project.pinned,
  });
}

export function cloneProjectSnapshot(
  project: ProjectSnapshot,
): ProjectSnapshot {
  if (!isProjectSnapshot(project)) {
    throw new Error('ProjectSnapshot 数据无效');
  }

  return Object.freeze({
    ...cloneProject(project),
    assetCount: project.assetCount,
  });
}
