import {
  WORKBENCH_PROTOCOL_VERSION,
  type AssetWorkbenchManifest,
} from '../../shared/workbench/manifest';
import type {
  JsonValue,
  WorkbenchCommand,
} from '../../shared/workbench/protocol';

export const PLAIN_TEXT_WORKBENCH_ID = 'builtin.plain-text';
export const PLAIN_TEXT_STATE_SCHEMA_VERSION = 2;
export const PLAIN_TEXT_STATE_SCHEMA_VERSION_V1 = 1;
export const PLAIN_TEXT_RECOVERY_DATA_KEY = 'recovery-content';
export const DEFAULT_PLAIN_TEXT_VIEW_OPTIONS:
  JsonValue & PlainTextViewOptions = Object.freeze({
    wordWrap: true,
    lineNumbers: true,
  });

export const plainTextWorkbenchManifest: AssetWorkbenchManifest = {
  id: PLAIN_TEXT_WORKBENCH_ID,
  version: 1,
  protocolVersion: WORKBENCH_PROTOCOL_VERSION,
  supportedMediaTypes: ['text/plain'],
  requiredContentCapabilities: ['read-text', 'write-text'],
  supportedAnchorTypes: [],
};

export type PlainTextLineEnding = 'lf' | 'crlf';
export type PlainTextEncoding = 'utf-8' | 'gbk';

export interface PlainTextViewOptions {
  readonly wordWrap: boolean;
  readonly lineNumbers: boolean;
}

export interface PlainTextViewState {
  readonly anchor: number;
  readonly head: number;
  readonly scrollTop: number;
}

export interface PlainTextRecoveryState {
  readonly dataKey: typeof PLAIN_TEXT_RECOVERY_DATA_KEY;
  readonly baseRevision: string;
  readonly encoding: PlainTextEncoding;
  readonly lineEnding: PlainTextLineEnding;
  readonly hasByteOrderMark: boolean;
  readonly updatedTime: number;
}

export interface PlainTextWorkbenchStateV1 {
  readonly viewState?: PlainTextViewState;
  readonly recovery?: PlainTextRecoveryState;
}

export interface PlainTextWorkbenchStateV2 {
  readonly viewState?: PlainTextViewState;
  readonly viewOptions: PlainTextViewOptions;
  readonly recovery?: PlainTextRecoveryState;
}

export interface PlainTextRecoveryBootstrap {
  readonly content: string;
  readonly baseRevision: string;
  readonly encoding: PlainTextEncoding;
  readonly lineEnding: PlainTextLineEnding;
  readonly hasByteOrderMark: boolean;
  readonly updatedTime: number;
  readonly sourceChanged: boolean;
}

export interface PlainTextWorkbenchPayload {
  readonly content: string;
  readonly encoding: PlainTextEncoding;
  readonly lineEnding: PlainTextLineEnding;
  readonly hasByteOrderMark: boolean;
  readonly revision: string;
  readonly viewOptions: PlainTextViewOptions;
  readonly viewState?: PlainTextViewState;
  readonly recovery?: PlainTextRecoveryBootstrap;
}

export interface PlainTextBufferPayload {
  readonly content: string;
  readonly lineEnding: PlainTextLineEnding;
  readonly viewState: PlainTextViewState;
}

export interface PlainTextSaveResult {
  readonly revision: string;
  readonly savedTime: number;
}

export interface PlainTextBackupResult {
  readonly backedUpTime: number;
}

export interface PlainTextLineEndingResult {
  readonly lineEnding: PlainTextLineEnding;
  readonly dirty: boolean;
}

export interface PlainTextReopenResult {
  readonly content: string;
  readonly encoding: PlainTextEncoding;
  readonly lineEnding: PlainTextLineEnding;
  readonly hasByteOrderMark: boolean;
  readonly revision: string;
}

export const plainTextCommands = {
  syncBuffer: 'plain-text:sync-buffer',
  backup: 'plain-text:backup',
  save: 'plain-text:save',
  saveViewState: 'plain-text:save-view-state',
  setViewOptions: 'plain-text:set-view-options',
  setLineEnding: 'plain-text:set-line-ending',
  reopenWithEncoding: 'plain-text:reopen-with-encoding',
  discardRecovery: 'plain-text:discard-recovery',
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isRequiredText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isPlainTextLineEnding(
  value: unknown,
): value is PlainTextLineEnding {
  return value === 'lf' || value === 'crlf';
}

export function isPlainTextEncoding(
  value: unknown,
): value is PlainTextEncoding {
  return value === 'utf-8' || value === 'gbk';
}

export function isPlainTextViewOptions(
  value: unknown,
): value is PlainTextViewOptions {
  return (
    isRecord(value) &&
    typeof value.wordWrap === 'boolean' &&
    typeof value.lineNumbers === 'boolean'
  );
}

export function isPlainTextViewState(
  value: unknown,
): value is PlainTextViewState {
  return (
    isRecord(value) &&
    isNonNegativeInteger(value.anchor) &&
    isNonNegativeInteger(value.head) &&
    typeof value.scrollTop === 'number' &&
    Number.isFinite(value.scrollTop) &&
    value.scrollTop >= 0
  );
}

export function isPlainTextWorkbenchStateV1(
  value: unknown,
): value is PlainTextWorkbenchStateV1 {
  if (!isRecord(value)) {
    return false;
  }

  const recovery = value.recovery;

  return (
    (value.viewState === undefined ||
      isPlainTextViewState(value.viewState)) &&
    (recovery === undefined ||
      (isRecord(recovery) &&
        recovery.dataKey === PLAIN_TEXT_RECOVERY_DATA_KEY &&
        isRequiredText(recovery.baseRevision) &&
        isPlainTextEncoding(recovery.encoding) &&
        isPlainTextLineEnding(recovery.lineEnding) &&
        typeof recovery.hasByteOrderMark === 'boolean' &&
        isNonNegativeInteger(recovery.updatedTime)))
  );
}

export function isPlainTextWorkbenchStateV2(
  value: unknown,
): value is PlainTextWorkbenchStateV2 {
  if (!isRecord(value)) {
    return false;
  }

  const recovery = value.recovery;

  return (
    (value.viewState === undefined ||
      isPlainTextViewState(value.viewState)) &&
    isPlainTextViewOptions(value.viewOptions) &&
    (recovery === undefined ||
      (isRecord(recovery) &&
        recovery.dataKey === PLAIN_TEXT_RECOVERY_DATA_KEY &&
        isRequiredText(recovery.baseRevision) &&
        isPlainTextEncoding(recovery.encoding) &&
        isPlainTextLineEnding(recovery.lineEnding) &&
        typeof recovery.hasByteOrderMark === 'boolean' &&
        isNonNegativeInteger(recovery.updatedTime)))
  );
}

export function isPlainTextWorkbenchPayload(
  value: JsonValue,
): value is JsonValue & PlainTextWorkbenchPayload {
  if (!isRecord(value)) {
    return false;
  }

  const recovery = value.recovery;

  return (
    typeof value.content === 'string' &&
    isPlainTextEncoding(value.encoding) &&
    isPlainTextLineEnding(value.lineEnding) &&
    typeof value.hasByteOrderMark === 'boolean' &&
    isRequiredText(value.revision) &&
    isPlainTextViewOptions(value.viewOptions) &&
    (value.viewState === undefined ||
      isPlainTextViewState(value.viewState)) &&
    (recovery === undefined ||
      (isRecord(recovery) &&
        typeof recovery.content === 'string' &&
        isRequiredText(recovery.baseRevision) &&
        isPlainTextEncoding(recovery.encoding) &&
        isPlainTextLineEnding(recovery.lineEnding) &&
        typeof recovery.hasByteOrderMark === 'boolean' &&
        isNonNegativeInteger(recovery.updatedTime) &&
        typeof recovery.sourceChanged === 'boolean'))
  );
}

export function isPlainTextBufferPayload(
  value: JsonValue | undefined,
): value is JsonValue & PlainTextBufferPayload {
  return (
    isRecord(value) &&
    typeof value.content === 'string' &&
    isPlainTextLineEnding(value.lineEnding) &&
    isPlainTextViewState(value.viewState)
  );
}

export function isPlainTextViewStatePayload(
  value: JsonValue | undefined,
): value is JsonValue & PlainTextViewState {
  return isPlainTextViewState(value);
}

export function isPlainTextSaveResult(
  value: JsonValue,
): value is JsonValue & PlainTextSaveResult {
  return (
    isRecord(value) &&
    isRequiredText(value.revision) &&
    isNonNegativeInteger(value.savedTime)
  );
}

export function isPlainTextBackupResult(
  value: JsonValue,
): value is JsonValue & PlainTextBackupResult {
  return isRecord(value) && isNonNegativeInteger(value.backedUpTime);
}

export function isPlainTextLineEndingResult(
  value: JsonValue,
): value is JsonValue & PlainTextLineEndingResult {
  return (
    isRecord(value) &&
    isPlainTextLineEnding(value.lineEnding) &&
    typeof value.dirty === 'boolean'
  );
}

export function isPlainTextReopenResult(
  value: JsonValue,
): value is JsonValue & PlainTextReopenResult {
  return (
    isRecord(value) &&
    typeof value.content === 'string' &&
    isPlainTextEncoding(value.encoding) &&
    isPlainTextLineEnding(value.lineEnding) &&
    typeof value.hasByteOrderMark === 'boolean' &&
    isRequiredText(value.revision)
  );
}

export function isPlainTextLineEndingPayload(
  value: JsonValue | undefined,
): value is JsonValue & { readonly lineEnding: PlainTextLineEnding } {
  return isRecord(value) && isPlainTextLineEnding(value.lineEnding);
}

export function isPlainTextEncodingPayload(
  value: JsonValue | undefined,
): value is JsonValue & { readonly encoding: PlainTextEncoding } {
  return isRecord(value) && isPlainTextEncoding(value.encoding);
}

export function createPlainTextBufferCommand(
  type:
    | typeof plainTextCommands.syncBuffer
    | typeof plainTextCommands.backup
    | typeof plainTextCommands.save,
  payload: PlainTextBufferPayload,
): WorkbenchCommand {
  return {
    type,
    payload: {
      content: payload.content,
      lineEnding: payload.lineEnding,
      viewState: {
        anchor: payload.viewState.anchor,
        head: payload.viewState.head,
        scrollTop: payload.viewState.scrollTop,
      },
    },
  };
}

export function createPlainTextViewStateCommand(
  viewState: PlainTextViewState,
): WorkbenchCommand {
  return {
    type: plainTextCommands.saveViewState,
    payload: {
      anchor: viewState.anchor,
      head: viewState.head,
      scrollTop: viewState.scrollTop,
    },
  };
}
