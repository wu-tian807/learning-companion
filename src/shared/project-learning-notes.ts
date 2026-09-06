import {
  cloneAssetTarget,
  isAssetTarget,
  type ContentAssetTarget,
} from './workbench/asset-target';

export const PROJECT_LEARNING_NOTE_MAX_LENGTH = 1_000_000;
export const PROJECT_LEARNING_NOTE_TARGET_LINK_PREFIX =
  '#learning-companion-target-v1=';
export const PROJECT_LEARNING_NOTE_ATTACHMENT_LINK_PREFIX =
  '#learning-companion-attachment-v1=';

const PROJECT_LEARNING_NOTE_TARGET_LINK_MAX_LENGTH = 100_000;

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

export interface ProjectLearningNoteTargetLink {
  readonly projectId: string;
  readonly assetId: string;
  readonly sourceRevision: string;
  readonly target: ContentAssetTarget;
}

export interface ProjectLearningNoteAttachmentLink {
  readonly projectId: string;
  readonly assetId: string;
  readonly attachmentId: string;
}

export type ProjectLearningNoteReferenceLink =
  | ProjectLearningNoteTargetLink
  | ProjectLearningNoteAttachmentLink;

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

function hasOnlyKeys(
  value: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value);
  return (
    actual.length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function isRequiredText(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value === value.trim()
  );
}

export function isProjectLearningNoteTargetLink(
  value: unknown,
): value is ProjectLearningNoteTargetLink {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      'projectId',
      'assetId',
      'sourceRevision',
      'target',
    ]) &&
    isProjectId(value.projectId) &&
    isRequiredText(value.assetId) &&
    isRequiredText(value.sourceRevision) &&
    isAssetTarget(value.target) &&
    value.target.scope === 'content'
  );
}

export function cloneProjectLearningNoteTargetLink(
  link: ProjectLearningNoteTargetLink,
): ProjectLearningNoteTargetLink {
  if (!isProjectLearningNoteTargetLink(link)) {
    throw new Error('学习笔记资料定位链接无效');
  }
  return Object.freeze({
    projectId: link.projectId,
    assetId: link.assetId,
    sourceRevision: link.sourceRevision,
    target: cloneAssetTarget(link.target) as ContentAssetTarget,
  });
}

export function isProjectLearningNoteAttachmentLink(
  value: unknown,
): value is ProjectLearningNoteAttachmentLink {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['projectId', 'assetId', 'attachmentId']) &&
    isProjectId(value.projectId) &&
    isRequiredText(value.assetId) &&
    isRequiredText(value.attachmentId)
  );
}

export function cloneProjectLearningNoteAttachmentLink(
  link: ProjectLearningNoteAttachmentLink,
): ProjectLearningNoteAttachmentLink {
  if (!isProjectLearningNoteAttachmentLink(link)) {
    throw new Error('学习笔记 Attachment 引用链接无效');
  }
  return Object.freeze({
    projectId: link.projectId,
    assetId: link.assetId,
    attachmentId: link.attachmentId,
  });
}

function encodeMarkdownLinkPayload(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/gu, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export function createProjectLearningNoteTargetHref(
  link: ProjectLearningNoteTargetLink,
): string {
  return (
    PROJECT_LEARNING_NOTE_TARGET_LINK_PREFIX +
    encodeMarkdownLinkPayload(
      JSON.stringify(cloneProjectLearningNoteTargetLink(link)),
    )
  );
}

export function parseProjectLearningNoteTargetHref(
  href: string,
): ProjectLearningNoteTargetLink | undefined {
  if (
    !href.startsWith(PROJECT_LEARNING_NOTE_TARGET_LINK_PREFIX) ||
    href.length > PROJECT_LEARNING_NOTE_TARGET_LINK_MAX_LENGTH
  ) {
    return undefined;
  }
  try {
    const decoded = decodeURIComponent(
      href.slice(PROJECT_LEARNING_NOTE_TARGET_LINK_PREFIX.length),
    );
    const value: unknown = JSON.parse(decoded);
    return isProjectLearningNoteTargetLink(value)
      ? cloneProjectLearningNoteTargetLink(value)
      : undefined;
  } catch {
    return undefined;
  }
}

export function createProjectLearningNoteAttachmentHref(
  link: ProjectLearningNoteAttachmentLink,
): string {
  return (
    PROJECT_LEARNING_NOTE_ATTACHMENT_LINK_PREFIX +
    encodeMarkdownLinkPayload(
      JSON.stringify(cloneProjectLearningNoteAttachmentLink(link)),
    )
  );
}

export function parseProjectLearningNoteAttachmentHref(
  href: string,
): ProjectLearningNoteAttachmentLink | undefined {
  if (
    !href.startsWith(PROJECT_LEARNING_NOTE_ATTACHMENT_LINK_PREFIX) ||
    href.length > PROJECT_LEARNING_NOTE_TARGET_LINK_MAX_LENGTH
  ) {
    return undefined;
  }
  try {
    const decoded = decodeURIComponent(
      href.slice(PROJECT_LEARNING_NOTE_ATTACHMENT_LINK_PREFIX.length),
    );
    const value: unknown = JSON.parse(decoded);
    return isProjectLearningNoteAttachmentLink(value)
      ? cloneProjectLearningNoteAttachmentLink(value)
      : undefined;
  } catch {
    return undefined;
  }
}

export function parseProjectLearningNoteReferenceHref(
  href: string,
): ProjectLearningNoteReferenceLink | undefined {
  return (
    parseProjectLearningNoteAttachmentHref(href) ??
    parseProjectLearningNoteTargetHref(href)
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
