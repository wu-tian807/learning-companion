import {
  WORKBENCH_PROTOCOL_VERSION,
  type AssetWorkbenchManifest,
} from '../../shared/workbench/manifest';
import type { ContentAssetTarget } from '../../shared/workbench/asset-target';
import {
  CORE_RENDERER_TRANSPORT_FACILITY_ID,
  createContextMenuSurfaceFacilityDeclaration,
  createTextSelectionInputFacilityDeclaration,
  overflowSurfaceFacilityDeclaration,
  rendererTransportFacilityDeclaration,
} from '../../shared/workbench/facilities/core-facilities';
import type {
  JsonValue,
  WorkbenchCommand,
} from '../../shared/workbench/protocol';

export const MARKDOWN_WORKBENCH_ID = 'builtin.markdown';
export const MARKDOWN_SOURCE_RANGE_ANCHOR_TYPE =
  'markdown.source-range';
export const MARKDOWN_VISUAL_SELECTION_ANCHOR_TYPE =
  'markdown.visual-selection';
export const MARKDOWN_IMAGE_TARGET_TYPE = 'markdown.image-source';
export const MARKDOWN_IMAGE_TARGET_VERSION = 1;
export const MARKDOWN_STATE_SCHEMA_VERSION = 1;
export const MARKDOWN_RECOVERY_DATA_KEY = 'recovery-content';
export const MARKDOWN_IMAGE_DIRECTORY = 'images';
export const MARKDOWN_MAX_IMAGE_BYTES = 15 * 1024 * 1024;

export type MarkdownViewMode = 'wysiwyg' | 'source';
export type MarkdownEditMode = MarkdownViewMode;
export type MarkdownEncoding = 'utf-8' | 'gbk';
export type MarkdownLineEnding = 'lf' | 'crlf';

export type MarkdownSourceViewState = {
  readonly anchor: number;
  readonly head: number;
  readonly scrollTop: number;
};

export function areMarkdownSourceViewStatesEqual(
  left: MarkdownSourceViewState | undefined,
  right: MarkdownSourceViewState,
): boolean {
  return (
    left?.anchor === right.anchor &&
    left.head === right.head &&
    left.scrollTop === right.scrollTop
  );
}

export type MarkdownWorkbenchViewState = {
  readonly viewMode: MarkdownViewMode;
  readonly sourceViewState?: MarkdownSourceViewState;
  readonly wysiwygScrollTop: number;
  readonly wordWrap: boolean;
  readonly outlineVisible: boolean;
};

export type MarkdownRecoveryState = {
  readonly dataKey: typeof MARKDOWN_RECOVERY_DATA_KEY;
  readonly baseRevision: string;
  readonly encoding: MarkdownEncoding;
  readonly lineEnding: MarkdownLineEnding;
  readonly hasByteOrderMark: boolean;
  readonly editedFrom: MarkdownEditMode;
  readonly updatedTime: number;
};

export type MarkdownWorkbenchStateV1 = MarkdownWorkbenchViewState & {
  readonly recovery?: MarkdownRecoveryState;
};

export type MarkdownRecoveryBootstrap = {
  readonly content: string;
  readonly baseRevision: string;
  readonly encoding: MarkdownEncoding;
  readonly lineEnding: MarkdownLineEnding;
  readonly hasByteOrderMark: boolean;
  readonly editedFrom: MarkdownEditMode;
  readonly updatedTime: number;
  readonly sourceChanged: boolean;
};

export type MarkdownWorkbenchPayload = {
  readonly diskSource: string;
  readonly encoding: MarkdownEncoding;
  readonly lineEnding: MarkdownLineEnding;
  readonly hasByteOrderMark: boolean;
  readonly revision: string;
  readonly state: MarkdownWorkbenchViewState;
  readonly recovery?: MarkdownRecoveryBootstrap;
};

export type MarkdownSourceBufferPayload = {
  readonly content: string;
  readonly lineEnding: MarkdownLineEnding;
  readonly sourceViewState: MarkdownSourceViewState;
};

export type MarkdownWysiwygBufferPayload = {
  readonly content: string;
  readonly lineEnding: MarkdownLineEnding;
  readonly wysiwygScrollTop: number;
};

export type MarkdownBufferSyncResult = {
  readonly accepted: true;
  readonly dirty: boolean;
};

export type MarkdownSaveResult = {
  readonly revision: string;
  readonly savedTime: number;
};

export type MarkdownBackupResult = {
  readonly backedUpTime: number;
};

export type MarkdownSaveViewStateResult = {
  readonly saved: true;
  readonly savedTime: number;
};

export type MarkdownLineEndingResult = {
  readonly lineEnding: MarkdownLineEnding;
  readonly dirty: boolean;
};

export type MarkdownReopenResult = {
  readonly diskSource: string;
  readonly encoding: MarkdownEncoding;
  readonly lineEnding: MarkdownLineEnding;
  readonly hasByteOrderMark: boolean;
  readonly revision: string;
};

export type MarkdownImageMediaType =
  | 'image/png'
  | 'image/jpeg'
  | 'image/gif'
  | 'image/webp'
  | 'image/bmp';

export type MarkdownInsertImagePayload = {
  readonly name: string;
  readonly mediaType: MarkdownImageMediaType;
  /** 图片原始字节的 base64；主进程写盘前会再次校验大小。 */
  readonly data: string;
};

export type MarkdownInsertImageResult = {
  readonly relativePath: string;
};

export type MarkdownReadImagePayload = {
  readonly relativePath: string;
};

export type MarkdownReadImageResult = {
  readonly dataUrl: string;
};

export const DEFAULT_MARKDOWN_WORKBENCH_STATE:
  MarkdownWorkbenchViewState = Object.freeze({
    viewMode: 'wysiwyg',
    wysiwygScrollTop: 0,
    wordWrap: true,
    outlineVisible: false,
  });

export const markdownWorkbenchManifest: AssetWorkbenchManifest<
  typeof MARKDOWN_WORKBENCH_ID
> = {
  id: MARKDOWN_WORKBENCH_ID,
  version: 1,
  protocolVersion: WORKBENCH_PROTOCOL_VERSION,
  supportedMediaTypes: ['text/markdown'],
  requiredContentCapabilities: ['read-bytes', 'write-bytes'],
  supportedTargetTypes: [
    MARKDOWN_SOURCE_RANGE_ANCHOR_TYPE,
    MARKDOWN_VISUAL_SELECTION_ANCHOR_TYPE,
    MARKDOWN_IMAGE_TARGET_TYPE,
  ],
  facilities: [
    rendererTransportFacilityDeclaration,
    overflowSurfaceFacilityDeclaration,
    createContextMenuSurfaceFacilityDeclaration(
      CORE_RENDERER_TRANSPORT_FACILITY_ID,
    ),
    createTextSelectionInputFacilityDeclaration(
      CORE_RENDERER_TRANSPORT_FACILITY_ID,
    ),
  ],
};

export const markdownCommands = {
  syncSourceBuffer: 'markdown:sync-source-buffer',
  syncWysiwygBuffer: 'markdown:sync-wysiwyg-buffer',
  backup: 'markdown:backup',
  save: 'markdown:save',
  saveViewState: 'markdown:save-view-state',
  setLineEnding: 'markdown:set-line-ending',
  reopenWithEncoding: 'markdown:reopen-with-encoding',
  discardRecovery: 'markdown:discard-recovery',
  insertImage: 'markdown:insert-image',
  readImage: 'markdown:read-image',
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRequiredText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

const MARKDOWN_IMAGE_MEDIA_TYPE_EXTENSIONS: Readonly<
  Record<MarkdownImageMediaType, string>
> = Object.freeze({
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/bmp': '.bmp',
});

const MARKDOWN_IMAGE_EXTENSION_MEDIA_TYPES: Readonly<
  Record<string, MarkdownImageMediaType>
> = Object.freeze({
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
});

export function isSupportedMarkdownImageMediaType(
  value: unknown,
): value is MarkdownImageMediaType {
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(
      MARKDOWN_IMAGE_MEDIA_TYPE_EXTENSIONS,
      value,
    )
  );
}

export function markdownImageExtensionFromMediaType(
  mediaType: MarkdownImageMediaType,
): string {
  return MARKDOWN_IMAGE_MEDIA_TYPE_EXTENSIONS[mediaType];
}

export function markdownImageMediaTypeFromName(
  name: string,
): MarkdownImageMediaType | undefined {
  const extension = name.slice(name.lastIndexOf('.')).toLowerCase();
  return MARKDOWN_IMAGE_EXTENSION_MEDIA_TYPES[extension];
}

function isSafeRelativePath(value: string): boolean {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 1_024 ||
    value.startsWith('/') ||
    value.includes('\\') ||
    value.includes(':')
  ) {
    return false;
  }
  const segments = value.split('/');
  return (
    segments.length > 0 &&
    segments.every(
      (segment) =>
        segment.length > 0 &&
        segment !== '.' &&
        segment !== '..' &&
        ![...segment].some(
          (character) =>
            '<>"|?*'.includes(character) ||
            character.charCodeAt(0) < 32,
        ),
    )
  );
}

export interface MarkdownImageTargetPayload {
  readonly relativePath: string;
}

export function isMarkdownImageTargetPayload(
  value: unknown,
): value is JsonValue & MarkdownImageTargetPayload {
  if (!isRecord(value)) return false;
  const relativePath = value.relativePath;
  return (
    isRequiredText(relativePath) &&
    isSafeRelativePath(relativePath) &&
    markdownImageMediaTypeFromName(relativePath) !== undefined
  );
}

export function createMarkdownImageTarget(
  relativePath: string,
): ContentAssetTarget {
  return {
    scope: 'content',
    targetType: MARKDOWN_IMAGE_TARGET_TYPE,
    targetVersion: MARKDOWN_IMAGE_TARGET_VERSION,
    targetPayload: {
      relativePath: relativePath.trim(),
    },
  };
}

/**
 * 生成图片引用的候选文本（原始相对路径、空格转义、百分号解码），
 * 用于在源码文本或图片 DOM 中回找同一张图。
 */
export function markdownImageReferenceCandidates(
  relativePath: string,
): readonly string[] {
  const normalized = relativePath.trim();
  const candidates = [normalized];
  const spaceEncoded = normalized.replace(/ /gu, '%20');
  if (!candidates.includes(spaceEncoded)) {
    candidates.push(spaceEncoded);
  }
  try {
    const decoded = decodeURIComponent(normalized);
    if (!candidates.includes(decoded)) {
      candidates.push(decoded);
    }
  } catch {
    // 保留原始与空格转义候选即可。
  }
  return candidates;
}

const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/u;

export function isMarkdownInsertImagePayload(
  value: unknown,
): value is JsonValue & MarkdownInsertImagePayload {
  if (!isRecord(value)) return false;
  if (
    !isRequiredText(value.name) ||
    [...String(value.name)].length > 128 ||
    !isSupportedMarkdownImageMediaType(value.mediaType)
  ) {
    return false;
  }
  const data = value.data;
  if (
    typeof data !== 'string' ||
    data.length === 0 ||
    data.length > Math.ceil((MARKDOWN_MAX_IMAGE_BYTES * 4) / 3) + 4 ||
    !BASE64_PATTERN.test(data)
  ) {
    return false;
  }
  return true;
}

export function isMarkdownInsertImageResult(
  value: unknown,
): value is JsonValue & MarkdownInsertImageResult {
  if (!isRecord(value)) return false;
  const relativePath = value.relativePath;
  return (
    isRequiredText(relativePath) &&
    isSafeRelativePath(relativePath) &&
    markdownImageMediaTypeFromName(relativePath) !== undefined
  );
}

export function isMarkdownReadImagePayload(
  value: unknown,
): value is JsonValue & MarkdownReadImagePayload {
  if (!isRecord(value)) return false;
  const relativePath = value.relativePath;
  return (
    isRequiredText(relativePath) &&
    isSafeRelativePath(relativePath) &&
    markdownImageMediaTypeFromName(relativePath) !== undefined
  );
}

export function isMarkdownReadImageResult(
  value: unknown,
): value is JsonValue & MarkdownReadImageResult {
  if (!isRecord(value) || typeof value.dataUrl !== 'string') {
    return false;
  }
  return (
    value.dataUrl.startsWith('data:image/') &&
    value.dataUrl.includes(';base64,') &&
    value.dataUrl.length <=
      Math.ceil((MARKDOWN_MAX_IMAGE_BYTES * 4) / 3) + 128
  );
}

/** 生成可写回 Markdown 源码的图片引用；空格会被百分号编码，其余字符原样保留。 */
export function createMarkdownImageReference(
  relativePath: string,
  alt?: string,
): string {
  const encodedPath = relativePath
    .split('/')
    .map((segment) => segment.replace(/ /gu, '%20'))
    .join('/');
  const label = (alt ?? relativePath.split('/').at(-1) ?? '图片')
    .replace(/[[\]]/gu, '')
    .slice(0, 120)
    .trim();
  return `![${label || '图片'}](${encodedPath})`;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isFinite(value) && value >= 0
  );
}

export function isMarkdownEncoding(
  value: unknown,
): value is MarkdownEncoding {
  return value === 'utf-8' || value === 'gbk';
}

export function isMarkdownLineEnding(
  value: unknown,
): value is MarkdownLineEnding {
  return value === 'lf' || value === 'crlf';
}

export function isMarkdownEditMode(
  value: unknown,
): value is MarkdownEditMode {
  return value === 'wysiwyg' || value === 'source';
}

export function isMarkdownSourceViewState(
  value: unknown,
): value is MarkdownSourceViewState {
  return (
    isRecord(value) &&
    isNonNegativeInteger(value.anchor) &&
    isNonNegativeInteger(value.head) &&
    isNonNegativeFiniteNumber(value.scrollTop)
  );
}

export function isMarkdownWorkbenchViewState(
  value: unknown,
): value is MarkdownWorkbenchViewState {
  return (
    isRecord(value) &&
    isMarkdownEditMode(value.viewMode) &&
    (value.sourceViewState === undefined ||
      isMarkdownSourceViewState(value.sourceViewState)) &&
    isNonNegativeFiniteNumber(value.wysiwygScrollTop) &&
    typeof value.wordWrap === 'boolean' &&
    typeof value.outlineVisible === 'boolean'
  );
}

export function isMarkdownRecoveryState(
  value: unknown,
): value is MarkdownRecoveryState {
  return (
    isRecord(value) &&
    value.dataKey === MARKDOWN_RECOVERY_DATA_KEY &&
    isRequiredText(value.baseRevision) &&
    isMarkdownEncoding(value.encoding) &&
    isMarkdownLineEnding(value.lineEnding) &&
    typeof value.hasByteOrderMark === 'boolean' &&
    isMarkdownEditMode(value.editedFrom) &&
    isNonNegativeInteger(value.updatedTime)
  );
}

export function isMarkdownWorkbenchStateV1(
  value: unknown,
): value is MarkdownWorkbenchStateV1 {
  if (!isRecord(value) || !isMarkdownWorkbenchViewState(value)) {
    return false;
  }

  const recovery = (value as Record<string, unknown>).recovery;
  return recovery === undefined || isMarkdownRecoveryState(recovery);
}

export function isMarkdownWorkbenchPayload(
  value: unknown,
): value is JsonValue & MarkdownWorkbenchPayload {
  if (!isRecord(value)) {
    return false;
  }

  const recovery = value.recovery;

  return (
    typeof value.diskSource === 'string' &&
    isMarkdownEncoding(value.encoding) &&
    isMarkdownLineEnding(value.lineEnding) &&
    typeof value.hasByteOrderMark === 'boolean' &&
    isRequiredText(value.revision) &&
    isMarkdownWorkbenchViewState(value.state) &&
    (recovery === undefined ||
      (isRecord(recovery) &&
        typeof recovery.content === 'string' &&
        isRequiredText(recovery.baseRevision) &&
        isMarkdownEncoding(recovery.encoding) &&
        isMarkdownLineEnding(recovery.lineEnding) &&
        typeof recovery.hasByteOrderMark === 'boolean' &&
        isMarkdownEditMode(recovery.editedFrom) &&
        isNonNegativeInteger(recovery.updatedTime) &&
        typeof recovery.sourceChanged === 'boolean'))
  );
}

export function isMarkdownSourceBufferPayload(
  value: JsonValue | undefined,
): value is JsonValue & MarkdownSourceBufferPayload {
  return (
    isRecord(value) &&
    typeof value.content === 'string' &&
    isMarkdownLineEnding(value.lineEnding) &&
    isMarkdownSourceViewState(value.sourceViewState) &&
    value.wysiwygScrollTop === undefined
  );
}

export function isMarkdownWysiwygBufferPayload(
  value: JsonValue | undefined,
): value is JsonValue & MarkdownWysiwygBufferPayload {
  return (
    isRecord(value) &&
    typeof value.content === 'string' &&
    isMarkdownLineEnding(value.lineEnding) &&
    isNonNegativeFiniteNumber(value.wysiwygScrollTop) &&
    value.sourceViewState === undefined
  );
}

export function isMarkdownBufferSyncResult(
  value: unknown,
): value is JsonValue & MarkdownBufferSyncResult {
  return (
    isRecord(value) &&
    value.accepted === true &&
    typeof value.dirty === 'boolean'
  );
}

export function isMarkdownSaveResult(
  value: unknown,
): value is JsonValue & MarkdownSaveResult {
  return (
    isRecord(value) &&
    isRequiredText(value.revision) &&
    isNonNegativeInteger(value.savedTime)
  );
}

export function isMarkdownBackupResult(
  value: unknown,
): value is JsonValue & MarkdownBackupResult {
  return isRecord(value) && isNonNegativeInteger(value.backedUpTime);
}

export function isMarkdownSaveViewStateResult(
  value: unknown,
): value is JsonValue & MarkdownSaveViewStateResult {
  return (
    isRecord(value) &&
    value.saved === true &&
    isNonNegativeInteger(value.savedTime)
  );
}

export function isMarkdownWorkbenchViewStatePayload(
  value: JsonValue | undefined,
): value is JsonValue & MarkdownWorkbenchViewState {
  return isMarkdownWorkbenchViewState(value);
}

export function isMarkdownLineEndingPayload(
  value: JsonValue | undefined,
): value is JsonValue & { readonly lineEnding: MarkdownLineEnding } {
  return isRecord(value) && isMarkdownLineEnding(value.lineEnding);
}

export function isMarkdownEncodingPayload(
  value: JsonValue | undefined,
): value is JsonValue & { readonly encoding: MarkdownEncoding } {
  return isRecord(value) && isMarkdownEncoding(value.encoding);
}

export function isMarkdownLineEndingResult(
  value: unknown,
): value is JsonValue & MarkdownLineEndingResult {
  return (
    isRecord(value) &&
    isMarkdownLineEnding(value.lineEnding) &&
    typeof value.dirty === 'boolean'
  );
}

export function isMarkdownReopenResult(
  value: unknown,
): value is JsonValue & MarkdownReopenResult {
  return (
    isRecord(value) &&
    typeof value.diskSource === 'string' &&
    isMarkdownEncoding(value.encoding) &&
    isMarkdownLineEnding(value.lineEnding) &&
    typeof value.hasByteOrderMark === 'boolean' &&
    isRequiredText(value.revision)
  );
}

export function cloneMarkdownSourceViewState(
  state: MarkdownSourceViewState,
): MarkdownSourceViewState {
  return {
    anchor: state.anchor,
    head: state.head,
    scrollTop: state.scrollTop,
  };
}

export function cloneMarkdownWorkbenchViewState(
  state: MarkdownWorkbenchViewState,
): MarkdownWorkbenchViewState {
  return {
    viewMode: state.viewMode,
    ...(state.sourceViewState
      ? {
          sourceViewState: cloneMarkdownSourceViewState(
            state.sourceViewState,
          ),
        }
      : {}),
    wysiwygScrollTop: state.wysiwygScrollTop,
    wordWrap: state.wordWrap,
    outlineVisible: state.outlineVisible,
  };
}

export function createMarkdownSyncSourceCommand(
  payload: MarkdownSourceBufferPayload,
): WorkbenchCommand {
  return {
    type: markdownCommands.syncSourceBuffer,
    payload: {
      content: payload.content,
      lineEnding: payload.lineEnding,
      sourceViewState: cloneMarkdownSourceViewState(
        payload.sourceViewState,
      ),
    },
  };
}

export function createMarkdownSyncWysiwygCommand(
  payload: MarkdownWysiwygBufferPayload,
): WorkbenchCommand {
  return {
    type: markdownCommands.syncWysiwygBuffer,
    payload: {
      content: payload.content,
      lineEnding: payload.lineEnding,
      wysiwygScrollTop: payload.wysiwygScrollTop,
    },
  };
}

export function createMarkdownSaveViewStateCommand(
  state: MarkdownWorkbenchViewState,
): WorkbenchCommand {
  return {
    type: markdownCommands.saveViewState,
    payload: {
      ...cloneMarkdownWorkbenchViewState(state),
    },
  };
}

export function createMarkdownInsertImageCommand(
  payload: MarkdownInsertImagePayload,
): WorkbenchCommand {
  return {
    type: markdownCommands.insertImage,
    payload: {
      name: payload.name,
      mediaType: payload.mediaType,
      data: payload.data,
    },
  };
}

export function createMarkdownReadImageCommand(
  relativePath: string,
): WorkbenchCommand {
  return {
    type: markdownCommands.readImage,
    payload: { relativePath },
  };
}
