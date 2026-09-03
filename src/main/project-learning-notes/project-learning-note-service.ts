import {
  cloneProjectLearningNote,
  PROJECT_LEARNING_NOTE_MAX_LENGTH,
  type ProjectLearningNoteSnapshot,
} from '../../shared/project-learning-notes';
import { AppError } from '../errors/app-error';
import type { ProjectLookup } from '../projects/project-database';
import type { ProjectLearningNoteDatabaseApi } from './project-learning-note-database';

export interface ProjectLearningNoteServiceApi {
  get(projectId: string): ProjectLearningNoteSnapshot;
  save(
    projectId: string,
    markdown: string,
    expectedRevision: number,
  ): ProjectLearningNoteSnapshot;
}

export class ProjectLearningNoteService
  implements ProjectLearningNoteServiceApi
{
  constructor(
    private readonly database: ProjectLearningNoteDatabaseApi,
    private readonly projects: ProjectLookup,
    private readonly now: () => number = Date.now,
  ) {}

  get(projectId: string): ProjectLearningNoteSnapshot {
    const normalizedProjectId = this.requireProject(projectId);
    const stored = this.database.get(normalizedProjectId);
    return stored
      ? cloneProjectLearningNote(stored)
      : cloneProjectLearningNote({
          projectId: normalizedProjectId,
          markdown: '',
          revision: 0,
          updatedTime: null,
        });
  }

  save(
    projectId: string,
    markdown: string,
    expectedRevision: number,
  ): ProjectLearningNoteSnapshot {
    const normalizedProjectId = this.requireProject(projectId);
    if (
      typeof markdown !== 'string' ||
      markdown.length > PROJECT_LEARNING_NOTE_MAX_LENGTH ||
      !Number.isSafeInteger(expectedRevision) ||
      expectedRevision < 0
    ) {
      throw new AppError('INVALID_IPC_REQUEST');
    }
    return this.database.save(
      normalizedProjectId,
      markdown,
      expectedRevision,
      this.now(),
    );
  }

  private requireProject(projectId: string): string {
    const normalized = projectId.trim();
    if (!normalized || normalized !== projectId) {
      throw new AppError('INVALID_IPC_REQUEST');
    }
    if (!this.projects.get(normalized)) {
      throw new AppError('PROJECT_NOT_FOUND');
    }
    return normalized;
  }
}
