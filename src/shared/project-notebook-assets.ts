export interface ProjectNotebookSnapshot {
  readonly projectId: string;
  /** Undefined means the restricted notebook viewport is in its empty state. */
  readonly assetId?: string;
}

export interface ProjectNotebookProjectRequest {
  readonly projectId: string;
}

export interface CreateProjectNotebookRequest
  extends ProjectNotebookProjectRequest {
  readonly name?: string;
}

export interface SelectProjectNotebookAssetRequest
  extends ProjectNotebookProjectRequest {
  readonly assetId: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value === value.trim();
}

/** Validates Main/preload notebook responses before renderer state is updated. */
export function isProjectNotebookSnapshot(
  value: unknown,
): value is ProjectNotebookSnapshot {
  return (
    isRecord(value) &&
    Object.keys(value).every((key) => key === 'projectId' || key === 'assetId') &&
    isId(value.projectId) &&
    (value.assetId === undefined || isId(value.assetId))
  );
}

export function isProjectNotebookProjectRequest(
  value: unknown,
): value is ProjectNotebookProjectRequest {
  return isRecord(value) && isId(value.projectId);
}

export function isCreateProjectNotebookRequest(
  value: unknown,
): value is CreateProjectNotebookRequest {
  return (
    isRecord(value) &&
    isProjectNotebookProjectRequest(value) &&
    (value.name === undefined ||
      (typeof value.name === 'string' &&
        value.name === value.name.trim() &&
        [...value.name].length > 0 &&
        [...value.name].length <= 160))
  );
}

export function isSelectProjectNotebookAssetRequest(
  value: unknown,
): value is SelectProjectNotebookAssetRequest {
  return (
    isRecord(value) &&
    isProjectNotebookProjectRequest(value) &&
    isId(value.assetId)
  );
}

export function cloneProjectNotebookSnapshot(
  value: ProjectNotebookSnapshot,
): ProjectNotebookSnapshot {
  return Object.freeze({ ...value });
}
