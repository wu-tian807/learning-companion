import type { AssetAttachment } from '../../../shared/attachments/contracts';
import type { JsonValue } from '../../../shared/workbench/protocol';
import {
  isEpubCfiRangeTarget,
  type EpubCfiRangeTarget,
} from '../shared';

export const EPUB_READING_NOTE_ATTACHMENT_TYPE = 'epub.reading-note';
export const EPUB_READING_NOTE_ATTACHMENT_VERSION = 1;
export const EPUB_READING_NOTE_MAX_LENGTH = 4_000;

export type EpubReadingNoteMetadata = JsonValue & {
  readonly format: 'learning-companion/epub-reading-note';
  readonly version: 1;
  readonly text: string;
};

export interface EpubReadingNoteView {
  readonly id: string;
  readonly projectId: string;
  readonly assetId: string;
  readonly target: EpubCfiRangeTarget;
  readonly text: string;
  readonly createdTime: number;
  readonly updatedTime: number;
}

export function findEpubReadingNoteAtTarget(
  notes: readonly EpubReadingNoteView[],
  target: EpubCfiRangeTarget,
): EpubReadingNoteView | undefined {
  return notes.find(
    (note) =>
      note.target.anchorPayload.cfiRange === target.anchorPayload.cfiRange,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
    [...value.text].length <= EPUB_READING_NOTE_MAX_LENGTH
  );
}

export function createEpubReadingNoteMetadata(
  text: string,
): EpubReadingNoteMetadata {
  const metadata: EpubReadingNoteMetadata = {
    format: 'learning-companion/epub-reading-note',
    version: 1,
    text: text.trim(),
  };
  if (!isEpubReadingNoteMetadata(metadata)) {
    throw new Error('EPUB 阅读笔记内容无效');
  }
  return metadata;
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
    createdTime: attachment.createdTime,
    updatedTime: attachment.updatedTime,
  });
}
