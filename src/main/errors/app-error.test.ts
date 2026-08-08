import { describe, expect, it, vi } from 'vitest';

import {
  AppError,
  describeAppError,
  handleAppError,
} from './app-error';

function createLogger() {
  return {
    warn: vi.fn(),
    error: vi.fn(),
  };
}

describe('App error policy', () => {
  it('maps recoverable domain errors to user-facing payloads', () => {
    const logger = createLogger();

    expect(
      handleAppError(
        'asset:relink',
        new AppError('ASSET_MEDIA_TYPE_MISMATCH'),
        logger,
      ),
    ).toEqual({
      code: 'ASSET_MEDIA_TYPE_MISMATCH',
      kind: 'user',
      message: '所选文件类型与原资料不一致，请重新选择同类型文件。',
      retryable: true,
    });
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('silently classifies superseded operations as cancellation', () => {
    const logger = createLogger();

    expect(
      handleAppError(
        'project:open',
        new AppError('OPERATION_SUPERSEDED'),
        logger,
      ),
    ).toEqual({
      code: 'OPERATION_SUPERSEDED',
      kind: 'cancelled',
      message: undefined,
      retryable: false,
    });
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('uses a safe fallback and logs unknown errors', () => {
    const logger = createLogger();
    const original = new Error('SQLite 原始错误');

    expect(handleAppError('project:create', original, logger)).toEqual({
      code: 'INTERNAL_ERROR',
      kind: 'internal',
      message: '操作没有完成，请稍后重试。',
      retryable: true,
    });
    expect(logger.error).toHaveBeenCalledWith(
      '[project:create] INTERNAL_ERROR',
      original,
    );
  });

  it('keeps the deepest cause as task-safe diagnostic detail', () => {
    const rpcError = new Error(
      'failed to load configuration: invalid transport\nin `mcp_servers.codex_apps`',
    );
    const error = new AppError('CODEX_REQUEST_FAILED', {
      cause: rpcError,
    });

    expect(describeAppError(error)).toEqual({
      code: 'CODEX_REQUEST_FAILED',
      kind: 'user',
      userMessage: 'AI 请求没有完成，请稍后重试。',
      retryable: true,
      detail:
        'failed to load configuration: invalid transport\nin `mcp_servers.codex_apps`',
    });
  });
});
