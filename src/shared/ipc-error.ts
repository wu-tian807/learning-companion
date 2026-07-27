export type IpcErrorKind = 'user' | 'cancelled' | 'internal';

export interface IpcErrorPayload {
  readonly code: string;
  readonly kind: IpcErrorKind;
  readonly message?: string;
  readonly retryable: boolean;
}

export type IpcResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: IpcErrorPayload };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isIpcErrorPayload(value: unknown): value is IpcErrorPayload {
  return (
    isRecord(value) &&
    typeof value.code === 'string' &&
    ['user', 'cancelled', 'internal'].includes(value.kind as string) &&
    (value.message === undefined || typeof value.message === 'string') &&
    typeof value.retryable === 'boolean'
  );
}

export function isIpcResult<T>(value: unknown): value is IpcResult<T> {
  if (!isRecord(value) || typeof value.ok !== 'boolean') {
    return false;
  }

  return value.ok
    ? Object.hasOwn(value, 'data')
    : isIpcErrorPayload(value.error);
}

export function userMessageFromError(
  error: unknown,
  fallback: string,
): string | undefined {
  if (!isIpcErrorPayload(error)) {
    return fallback;
  }

  if (error.kind === 'cancelled') {
    return undefined;
  }

  return error.message ?? fallback;
}
