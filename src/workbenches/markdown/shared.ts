import {
  WORKBENCH_PROTOCOL_VERSION,
  type AssetWorkbenchManifest,
} from '../../shared/workbench/manifest';
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
export const MARKDOWN_STATE_SCHEMA_VERSION = 1;
export const MARKDOWN_RECOVERY_DATA_KEY = 'recovery-content';

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

export const DEFAULT_MARKDOWN_WORKBENCH_STATE:
  MarkdownWorkbenchViewState = Object.freeze({
    viewMode: 'wysiwyg',
    wysiwygScrollTop: 0,
    wordWrap: true,
    outlineVisible: false,
  });

export const markdownWorkbenchManifest: AssetWorkbenchManifest = {
  id: MARKDOWN_WORKBENCH_ID,
  version: 1,
  protocolVersion: WORKBENCH_PROTOCOL_VERSION,
  supportedMediaTypes: ['text/markdown'],
  requiredContentCapabilities: ['read-bytes', 'write-bytes'],
  supportedAnchorTypes: [
    MARKDOWN_SOURCE_RANGE_ANCHOR_TYPE,
    MARKDOWN_VISUAL_SELECTION_ANCHOR_TYPE,
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
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRequiredText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
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
