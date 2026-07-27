import {
  WORKBENCH_PROTOCOL_VERSION,
  type AssetWorkbenchManifest,
} from '../../shared/workbench/manifest';
import type {
  JsonValue,
  WorkbenchCommand,
} from '../../shared/workbench/protocol';

export const PLAIN_TEXT_WORKBENCH_ID = 'builtin.plain-text';
export const PLAIN_TEXT_STATE_SCHEMA_VERSION = 1;
export const PLAIN_TEXT_RECOVERY_DATA_KEY = 'recovery-content';

export const plainTextWorkbenchManifest: AssetWorkbenchManifest = {
  id: PLAIN_TEXT_WORKBENCH_ID,
  version: 1,
  protocolVersion: WORKBENCH_PROTOCOL_VERSION,
  supportedMediaTypes: ['text/plain'],
  requiredContentCapabilities: ['read-text', 'write-text'],
  supportedAnchorTypes: [],
};

export type PlainTextLineEnding = 'lf' | 'crlf';

export interface PlainTextViewState {
  readonly anchor: number;
  readonly head: number;
  readonly scrollTop: number;
}

export interface PlainTextRecoveryState {
  readonly dataKey: typeof PLAIN_TEXT_RECOVERY_DATA_KEY;
  readonly baseRevision: string;
  readonly encoding: string;
  readonly lineEnding: PlainTextLineEnding;
  readonly hasByteOrderMark: boolean;
  readonly updatedTime: number;
}

export interface PlainTextWorkbenchStateV1 {
  readonly viewState?: PlainTextViewState;
  readonly recovery?: PlainTextRecoveryState;
}

export interface PlainTextRecoveryBootstrap {
  readonly content: string;
  readonly baseRevision: string;
  readonly updatedTime: number;
  readonly sourceChanged: boolean;
}

export interface PlainTextWorkbenchPayload {
  readonly content: string;
  readonly encoding: string;
  readonly lineEnding: PlainTextLineEnding;
  readonly hasByteOrderMark: boolean;
  readonly revision: string;
  readonly viewState?: PlainTextViewState;
  readonly recovery?: PlainTextRecoveryBootstrap;
}

export interface PlainTextBufferPayload {
  readonly content: string;
  readonly viewState: PlainTextViewState;
}

export interface PlainTextSaveResult {
  readonly revision: string;
  readonly savedTime: number;
}

export interface PlainTextBackupResult {
  readonly backedUpTime: number;
}

export const plainTextCommands = {
  syncBuffer: 'plain-text:sync-buffer',
  backup: 'plain-text:backup',
  save: 'plain-text:save',
  saveViewState: 'plain-text:save-view-state',
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

function isTextLineEnding(value: unknown): value is PlainTextLineEnding {
  return value === 'lf' || value === 'crlf';
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
        isRequiredText(recovery.encoding) &&
        isTextLineEnding(recovery.lineEnding) &&
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
    isRequiredText(value.encoding) &&
    isTextLineEnding(value.lineEnding) &&
    typeof value.hasByteOrderMark === 'boolean' &&
    isRequiredText(value.revision) &&
    (value.viewState === undefined ||
      isPlainTextViewState(value.viewState)) &&
    (recovery === undefined ||
      (isRecord(recovery) &&
        typeof recovery.content === 'string' &&
        isRequiredText(recovery.baseRevision) &&
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
