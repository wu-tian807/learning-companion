import { isAbsolute } from 'node:path';

import { AppError } from '../../errors/app-error';
import type {
  CodexThread,
  CodexThreadItem,
  CodexTurn,
} from './codex-runtime-types';

export function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function requireNonEmptyString(
  value: string,
  name: string,
): string {
  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new AppError('DATA_INTEGRITY_ERROR', {
      cause: new Error(`${name} cannot be empty`),
    });
  }

  return normalized;
}

export function requireAbsolutePath(
  value: string,
  name: string,
): string {
  if (!isAbsolute(value)) {
    throw new AppError('DATA_INTEGRITY_ERROR', {
      cause: new Error(`${name} must be an absolute path`),
    });
  }

  return value;
}

export function optionalAbsolutePath(
  value: string | undefined,
  name: string,
): string | undefined {
  return value === undefined
    ? undefined
    : requireAbsolutePath(value, name);
}

export function optionalAbsolutePaths(
  values: readonly string[] | undefined,
  name: string,
): string[] | undefined {
  return values?.map((value) => requireAbsolutePath(value, name));
}

export function requireThread(value: unknown): CodexThread {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    value.id.length === 0
  ) {
    throw new AppError('CODEX_PROTOCOL_ERROR');
  }

  return value as CodexThread;
}

export function requireTurn(value: unknown): CodexTurn {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    value.id.length === 0 ||
    typeof value.status !== 'string'
  ) {
    throw new AppError('CODEX_PROTOCOL_ERROR');
  }

  return value as CodexTurn;
}

export function requireThreadItem(
  value: unknown,
): CodexThreadItem {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.type !== 'string'
  ) {
    throw new AppError('CODEX_PROTOCOL_ERROR');
  }

  return value as CodexThreadItem;
}

export function optionalThreadId(
  params: unknown,
): string | undefined {
  return isRecord(params) && typeof params.threadId === 'string'
    ? params.threadId
    : undefined;
}

export function optionalTurnId(
  params: unknown,
): string | undefined {
  return isRecord(params) && typeof params.turnId === 'string'
    ? params.turnId
    : undefined;
}
