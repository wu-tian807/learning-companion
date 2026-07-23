import type { Project } from './project';

export interface CreateProjectInput {
  name: string;
}

export interface ProjectRepository {
  list(): readonly Project[];
  create(input: CreateProjectInput): Project;
  rename(id: string, name: string): Project;
  setPinned(id: string, pinned: boolean): Project;
  delete(id: string): void;
}
