import { eq } from 'drizzle-orm';

import type { DatabaseContext } from '../database/database-context';
import { projects } from '../database/schema/projects';
import { AppError } from '../errors/app-error';
import {
  cloneProject,
  createProjectSnapshot,
  type Project,
  type ProjectInput,
  type UpdateProjectInput,
} from './project';

export interface ProjectLookup {
  get(id: string): Project | undefined;
}

export interface ProjectDatabaseApi extends ProjectLookup {
  initialize(): void;
  list(): readonly Project[];
  add(input: ProjectInput): Project;
  update(id: string, changes: UpdateProjectInput): Project;
  updateWorkspace(id: string, workspacePath: string): Project;
  delete(id: string): void;
}

const mutableProjectFields = new Set<keyof UpdateProjectInput>([
  'name',
  'icon',
  'pinned',
]);

export class ProjectDatabase implements ProjectDatabaseApi {
  private projectMap = new Map<string, Project>();
  private initialized = false;

  constructor(
    private readonly context: DatabaseContext,
  ) {}

  initialize(): void {
    if (this.initialized) {
      return;
    }

    const nextProjectMap = new Map<string, Project>();
    const rows = this.context.db.select().from(projects).all();

    for (const row of rows) {
      const project = createProjectSnapshot(row);

      if (nextProjectMap.has(project.id)) {
        throw new AppError('DATA_INTEGRITY_ERROR');
      }

      nextProjectMap.set(project.id, project);
    }

    this.projectMap = nextProjectMap;
    this.initialized = true;
  }

  list(): readonly Project[] {
    this.requireInitialized();
    return [...this.projectMap.values()].map(cloneProject);
  }

  get(id: string): Project | undefined {
    this.requireInitialized();
    const project = this.projectMap.get(id);
    return project ? cloneProject(project) : undefined;
  }

  add(input: ProjectInput): Project {
    this.requireInitialized();
    const project = createProjectSnapshot(input);

    if (this.projectMap.has(project.id)) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }

    const result = this.context.db.insert(projects).values(project).run();

    if (result.changes !== 1) {
      throw new AppError('DATABASE_WRITE_CONFLICT');
    }

    this.projectMap.set(project.id, project);

    return cloneProject(project);
  }

  update(id: string, changes: UpdateProjectInput): Project {
    this.requireInitialized();
    this.validateUpdate(changes);

    const currentProject = this.find(id);
    const nextProject = createProjectSnapshot({
      ...currentProject,
      name: changes.name ?? currentProject.name,
      icon: changes.icon ?? currentProject.icon,
      pinned: changes.pinned ?? currentProject.pinned,
    });
    const result = this.context.db
      .update(projects)
      .set({
        name: nextProject.name,
        icon: nextProject.icon,
        pinned: nextProject.pinned,
      })
      .where(eq(projects.id, id))
      .run();

    if (result.changes !== 1) {
      throw new AppError('DATABASE_WRITE_CONFLICT');
    }

    this.projectMap.set(id, nextProject);
    return cloneProject(nextProject);
  }

  updateWorkspace(id: string, workspacePath: string): Project {
    this.requireInitialized();
    const currentProject = this.find(id);
    const nextProject = createProjectSnapshot({
      ...currentProject,
      workspacePath,
    });
    const result = this.context.db
      .update(projects)
      .set({ workspacePath: nextProject.workspacePath })
      .where(eq(projects.id, id))
      .run();

    if (result.changes !== 1) {
      throw new AppError('DATABASE_WRITE_CONFLICT');
    }

    this.projectMap.set(id, nextProject);
    return cloneProject(nextProject);
  }

  delete(id: string): void {
    this.requireInitialized();
    this.find(id);

    const result = this.context.db.delete(projects).where(eq(projects.id, id)).run();

    if (result.changes !== 1) {
      throw new AppError('DATABASE_WRITE_CONFLICT');
    }

    this.projectMap.delete(id);
  }

  private find(id: string): Project {
    const project = this.projectMap.get(id);

    if (!project) {
      throw new AppError('PROJECT_NOT_FOUND');
    }

    return project;
  }

  private requireInitialized(): void {
    if (!this.initialized) {
      throw new AppError('SERVICE_NOT_READY');
    }
  }

  private validateUpdate(changes: UpdateProjectInput): void {
    const keys = Object.keys(changes);

    if (
      keys.length === 0 ||
      keys.some((key) => !mutableProjectFields.has(key as keyof UpdateProjectInput)) ||
      (changes.name === undefined &&
        changes.icon === undefined &&
        changes.pinned === undefined)
    ) {
      throw new AppError('INVALID_IPC_REQUEST');
    }
  }
}
