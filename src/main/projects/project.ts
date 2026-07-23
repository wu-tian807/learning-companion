import {
  PROJECT_ICON_MAX_CODE_POINTS,
  PROJECT_NAME_MAX_LENGTH,
} from '../../shared/ipc';

export interface Project {
  readonly id: string;
  readonly name: string;
  readonly icon: string;
  readonly createdTime: Date;
  readonly pinned: boolean;
}

export interface ProjectInput {
  readonly id: string;
  readonly name: string;
  readonly icon: string;
  readonly createdTime: Date;
  readonly pinned?: boolean;
}

export interface CreateProjectInput {
  readonly name: string;
}

export interface UpdateProjectInput {
  readonly name?: string;
  readonly icon?: string;
  readonly pinned?: boolean;
}

function requireText(value: string, field: string, maxLength?: number): string {
  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new Error(`Project ${field} 不能为空`);
  }

  if (maxLength !== undefined && [...normalized].length > maxLength) {
    throw new Error(`Project ${field} 过长`);
  }

  return normalized;
}

export function createProjectSnapshot(input: ProjectInput): Project {
  if (Number.isNaN(input.createdTime.getTime())) {
    throw new Error('Project createdTime 必须是有效日期');
  }

  if (input.pinned !== undefined && typeof input.pinned !== 'boolean') {
    throw new Error('Project pinned 必须是布尔值');
  }

  return Object.freeze({
    id: requireText(input.id, 'id'),
    name: requireText(input.name, 'name', PROJECT_NAME_MAX_LENGTH),
    icon: requireText(input.icon, 'icon', PROJECT_ICON_MAX_CODE_POINTS),
    createdTime: new Date(input.createdTime.getTime()),
    pinned: input.pinned ?? false,
  });
}

export function cloneProject(project: Project): Project {
  return createProjectSnapshot(project);
}
