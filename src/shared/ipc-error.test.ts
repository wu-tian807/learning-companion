import { describe, expect, it } from 'vitest';

import {
  isIpcErrorPayload,
  isIpcResult,
  userMessageFromError,
} from './ipc-error';

describe('IPC error payload', () => {
  const userError = {
    code: 'ASSET_MEDIA_TYPE_MISMATCH',
    kind: 'user' as const,
    message: '请选择同类型文件。',
    retryable: true,
  };

  it('validates success and failure results', () => {
    expect(isIpcResult({ ok: true, data: [] })).toBe(true);
    expect(isIpcResult({ ok: false, error: userError })).toBe(true);
    expect(isIpcResult({ ok: false, error: { code: 1 } })).toBe(false);
    expect(isIpcErrorPayload(userError)).toBe(true);
  });

  it('returns user messages, suppresses cancellation and falls back safely', () => {
    expect(userMessageFromError(userError, '默认错误')).toBe(
      '请选择同类型文件。',
    );
    expect(
      userMessageFromError(
        {
          code: 'OPERATION_SUPERSEDED',
          kind: 'cancelled',
          retryable: false,
        },
        '默认错误',
      ),
    ).toBeUndefined();
    expect(userMessageFromError(new Error('raw'), '默认错误')).toBe(
      '默认错误',
    );
  });
});
