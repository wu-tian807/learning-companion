export const PROJECT_LEARNING_NOTE_MAX_LENGTH = 1_000_000;

export interface ProjectLearningNoteSnapshot {
  readonly projectId: string;
  readonly markdown: string;
  readonly revision: number;
  readonly updatedTime: number | null;
}

export interface ProjectLearningNoteProjectRequest {
  readonly projectId: string;
}

export interface SaveProjectLearningNoteRequest
  extends ProjectLearningNoteProjectRequest {
  readonly markdown: string;
  readonly expectedRevision: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isProjectId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value === value.trim()
  );
}

export function isProjectLearningNoteProjectRequest(
  value: unknown,
): value is ProjectLearningNoteProjectRequest {
  return isRecord(value) && isProjectId(value.projectId);
}

export function isSaveProjectLearningNoteRequest(
  value: unknown,
): value is SaveProjectLearningNoteRequest {
  return (
    isRecord(value) &&
    isProjectLearningNoteProjectRequest(value) &&
    typeof value.markdown === 'string' &&
    value.markdown.length <= PROJECT_LEARNING_NOTE_MAX_LENGTH &&
    typeof value.expectedRevision === 'number' &&
    Number.isSafeInteger(value.expectedRevision) &&
    value.expectedRevision >= 0
  );
}

export function cloneProjectLearningNote(
  note: ProjectLearningNoteSnapshot,
): ProjectLearningNoteSnapshot {
  return Object.freeze({ ...note });
}
