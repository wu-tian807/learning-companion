import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';

import type { DatabaseContext } from '../database/database-context';
import { projects } from '../database/schema/projects';
import {
  cloneProject,
  createProjectSnapshot,
  type CreateProjectInput,
  type Project,
  type UpdateProjectInput,
} from './project';

export interface ProjectLookup {
  get(id: string): Project | undefined;
}

export interface ProjectDatabaseApi extends ProjectLookup {
  initialize(): void;
  list(): readonly Project[];
  add(input: CreateProjectInput): Project;
  update(id: string, changes: UpdateProjectInput): Project;
  delete(id: string): void;
}

export interface ProjectDatabaseDependencies {
  readonly createId: () => string;
  readonly now: () => Date;
  readonly defaultIcon: () => string;
}

const defaultDependencies: ProjectDatabaseDependencies = {
  createId: randomUUID,
  now: () => new Date(),
  defaultIcon: () => '📘',
};

const mutableProjectFields = new Set<keyof UpdateProjectInput>([
  'name',
  'icon',
  'pinned',
]);

export class ProjectDatabase implements ProjectDatabaseApi {
  private projectMap = new Map<string, Project>();
  private initialized = false;
  private readonly dependencies: ProjectDatabaseDependencies;

  constructor(
    private readonly context: DatabaseContext,
    dependencies: Partial<ProjectDatabaseDependencies> = {},
  ) {
    this.dependencies = {
      ...defaultDependencies,
      ...dependencies,
    };
  }

  initialize(): void {
    if (this.initialized) {
      return;
    }

    const nextProjectMap = new Map<string, Project>();
    const rows = this.context.db.select().from(projects).all();

    for (const row of rows) {
      const project = createProjectSnapshot(row);

      if (nextProjectMap.has(project.id)) {
        throw new Error(`数据库包含重复的 Project ID：${project.id}`);
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

  add(input: CreateProjectInput): Project {
    this.requireInitialized();

    const project = createProjectSnapshot({
      id: this.dependencies.createId(),
      name: input.name,
      icon: this.dependencies.defaultIcon(),
      createdTime: this.dependencies.now(),
    });

    if (this.projectMap.has(project.id)) {
      throw new Error(`Project ID 已存在：${project.id}`);
    }

    const result = this.context.db.insert(projects).values(project).run();

    if (result.changes !== 1) {
      throw new Error(`Project 创建影响了 ${result.changes} 行`);
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
      throw new Error(`Project 更新影响了 ${result.changes} 行`);
    }

    this.projectMap.set(id, nextProject);
    return cloneProject(nextProject);
  }

  delete(id: string): void {
    this.requireInitialized();
    this.find(id);

    const result = this.context.db.delete(projects).where(eq(projects.id, id)).run();

    if (result.changes !== 1) {
      throw new Error(`Project 删除影响了 ${result.changes} 行`);
    }

    this.projectMap.delete(id);
  }

  private find(id: string): Project {
    const project = this.projectMap.get(id);

    if (!project) {
      throw new Error('找不到指定的 Project');
    }

    return project;
  }

  private requireInitialized(): void {
    if (!this.initialized) {
      throw new Error('ProjectDatabase 尚未初始化');
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
      throw new Error('Project 更新内容无效');
    }
  }
}
