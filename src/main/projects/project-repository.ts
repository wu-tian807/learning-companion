import type { Project } from './project';

export interface ProjectRepository {
  list(): readonly Project[];
}
