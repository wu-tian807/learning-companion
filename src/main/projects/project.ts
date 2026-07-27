import {
  cloneProject as cloneSharedProject,
  type Project,
} from '../../shared/projects';

export interface ProjectInput {
  readonly id: string;
  readonly name: string;
  readonly icon: string;
  readonly createdTime: number;
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

export function createProjectSnapshot(input: ProjectInput): Project {
  return cloneSharedProject({
    id: input.id,
    name: input.name,
    icon: input.icon,
    createdTime: input.createdTime,
    pinned: input.pinned ?? false,
  });
}

export function cloneProject(project: Project): Project {
  return cloneSharedProject(project);
}

export type { Project };
