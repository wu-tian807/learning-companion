import type { AssetAttachment } from '../../../shared/attachments/contracts';
import type { JsonValue } from '../../../shared/workbench/protocol';
import {
  isEpubCfiRangeTarget,
  type EpubCfiRangeTarget,
} from '../shared';
import {
  isEpubMarkerColor,
  type EpubMarkerColor,
} from '../epub-marker-style';

export const EPUB_READING_NOTE_ATTACHMENT_TYPE = 'epub.reading-note';
export const EPUB_READING_NOTE_ATTACHMENT_VERSION = 1;
export const EPUB_READING_NOTE_MAX_LENGTH = 4_000;
export const EPUB_READING_NOTE_IPC_CHANNELS = Object.freeze({
  create: 'epub-reading-note:create',
  update: 'epub-reading-note:update',
  delete: 'epub-reading-note:delete',
});

export type EpubReadingNoteMetadata = JsonValue & {
  readonly format: 'learning-companion/epub-reading-note';
  readonly version: 1;
  readonly text: string;
  readonly markerColor?: EpubMarkerColor;
};

export interface EpubReadingNoteView {
  readonly id: string;
  readonly projectId: string;
  readonly assetId: string;
  readonly target: EpubCfiRangeTarget;
  readonly text: string;
  readonly markerColor: EpubMarkerColor;
  readonly createdTime: number;
  readonly updatedTime: number;
}

export interface EpubReadingNoteScopeRequest {
  readonly projectId: string;
  readonly assetId: string;
}

export interface CreateEpubReadingNoteRequest
  extends EpubReadingNoteScopeRequest {
  readonly target: EpubCfiRangeTarget;
  readonly text: string;
  readonly markerColor: EpubMarkerColor;
}

export interface UpdateEpubReadingNoteRequest
  extends EpubReadingNoteScopeRequest {
  readonly noteId: string;
  readonly text: string;
  readonly markerColor: EpubMarkerColor;
}

export interface DeleteEpubReadingNoteRequest
  extends EpubReadingNoteScopeRequest {
  readonly noteId: string;
}

export interface EpubReadingNotePreloadApi {
  createEpubReadingNote(
    request: CreateEpubReadingNoteRequest,
  ): Promise<EpubReadingNoteView>;
  updateEpubReadingNote(
    request: UpdateEpubReadingNoteRequest,
  ): Promise<EpubReadingNoteView>;
  deleteEpubReadingNote(
    request: DeleteEpubReadingNoteRequest,
  ): Promise<void>;
}

export function findEpubReadingNoteAtTarget(
  notes: readonly EpubReadingNoteView[],
  target: EpubCfiRangeTarget,
): EpubReadingNoteView | undefined {
  return notes.find(
    (note) =>
      note.target.targetPayload.cfiRange === target.targetPayload.cfiRange,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRequiredText(value: unknown, maximum = 256): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= maximum
  );
}

export function isEpubReadingNoteMetadata(
  value: unknown,
): value is EpubReadingNoteMetadata {
  return (
    isRecord(value) &&
    value.format === 'learning-companion/epub-reading-note' &&
    value.version === 1 &&
    typeof value.text === 'string' &&
    value.text.trim().length > 0 &&
    [...value.text].length <= EPUB_READING_NOTE_MAX_LENGTH &&
    (value.markerColor === undefined || isEpubMarkerColor(value.markerColor))
  );
}

export function createEpubReadingNoteMetadata(
  text: string,
  markerColor: EpubMarkerColor = 'yellow',
): EpubReadingNoteMetadata {
  const metadata: EpubReadingNoteMetadata = {
    format: 'learning-companion/epub-reading-note',
    version: 1,
    text: text.trim(),
    markerColor,
  };
  if (!isEpubReadingNoteMetadata(metadata)) {
    throw new Error('EPUB 阅读笔记内容无效');
  }
  return metadata;
}

export function isEpubReadingNoteScopeRequest(
  value: unknown,
): value is EpubReadingNoteScopeRequest {
  return (
    isRecord(value) &&
    isRequiredText(value.projectId) &&
    isRequiredText(value.assetId)
  );
}

function hasValidReadingNoteContents(
  value: Record<string, unknown>,
): value is Record<string, unknown> & {
  readonly text: string;
  readonly markerColor: EpubMarkerColor;
} {
  return (
    typeof value.text === 'string' &&
    isEpubMarkerColor(value.markerColor) &&
    isEpubReadingNoteMetadata({
      format: 'learning-companion/epub-reading-note',
      version: 1,
      text: value.text,
      markerColor: value.markerColor,
    })
  );
}

export function isCreateEpubReadingNoteRequest(
  value: unknown,
): value is CreateEpubReadingNoteRequest {
  return (
    isRecord(value) &&
    isEpubReadingNoteScopeRequest(value) &&
    isEpubCfiRangeTarget(value.target) &&
    hasValidReadingNoteContents(value)
  );
}

export function isUpdateEpubReadingNoteRequest(
  value: unknown,
): value is UpdateEpubReadingNoteRequest {
  return (
    isRecord(value) &&
    isEpubReadingNoteScopeRequest(value) &&
    isRequiredText(value.noteId) &&
    hasValidReadingNoteContents(value)
  );
}

export function isDeleteEpubReadingNoteRequest(
  value: unknown,
): value is DeleteEpubReadingNoteRequest {
  return (
    isRecord(value) &&
    isEpubReadingNoteScopeRequest(value) &&
    isRequiredText(value.noteId)
  );
}

export function toEpubReadingNoteView(
  attachment: AssetAttachment,
): EpubReadingNoteView | undefined {
  if (
    attachment.typeId !== EPUB_READING_NOTE_ATTACHMENT_TYPE ||
    attachment.typeVersion !== EPUB_READING_NOTE_ATTACHMENT_VERSION ||
    !isEpubCfiRangeTarget(attachment.target) ||
    !isEpubReadingNoteMetadata(attachment.metadata)
  ) {
    return undefined;
  }
  return Object.freeze({
    id: attachment.id,
    projectId: attachment.projectId,
    assetId: attachment.assetId,
    target: attachment.target,
    text: attachment.metadata.text,
    markerColor: attachment.metadata.markerColor ?? 'yellow',
    createdTime: attachment.createdTime,
    updatedTime: attachment.updatedTime,
  });
}
