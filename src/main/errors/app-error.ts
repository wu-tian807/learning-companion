import type { IpcErrorKind, IpcErrorPayload } from '../../shared/ipc-error';

export type AppErrorCode =
  | 'OPERATION_SUPERSEDED'
  | 'PROJECT_CONTEXT_CHANGED'
  | 'CONTENT_RESOLVER_NOT_FOUND'
  | 'REGISTRATION_CONFLICT'
  | 'INVALID_EXTENSION_DEFINITION'
  | 'FEATURE_NOT_SUPPORTED'
  | 'WORKBENCH_SESSION_NOT_FOUND'
  | 'WORKBENCH_SESSION_EXPIRED'
  | 'CONTENT_CHANGED_EXTERNALLY'
  | 'CONTENT_ENCODING_UNSUPPORTED'
  | 'CONTENT_ENCODING_LOSS'
  | 'CONTENT_WRITE_FAILED'
  | 'ASSET_MEDIA_TYPE_MISMATCH'
  | 'ASSET_UNAVAILABLE'
  | 'ASSET_NOT_FOUND'
  | 'PROJECT_NOT_FOUND'
  | 'INVALID_IPC_REQUEST'
  | 'DATABASE_WRITE_CONFLICT'
  | 'DATA_INTEGRITY_ERROR'
  | 'SERVICE_NOT_READY';

interface ErrorPolicy {
  readonly kind: IpcErrorKind;
  readonly userMessage?: string;
  readonly retryable: boolean;
  readonly logLevel: 'silent' | 'warn' | 'error';
}

interface ErrorLogger {
  warn(message: string, error?: unknown): void;
  error(message: string, error?: unknown): void;
}

const errorPolicies: Record<AppErrorCode, ErrorPolicy> = {
  OPERATION_SUPERSEDED: {
    kind: 'cancelled',
    retryable: false,
    logLevel: 'silent',
  },
  PROJECT_CONTEXT_CHANGED: {
    kind: 'cancelled',
    retryable: false,
    logLevel: 'silent',
  },
  CONTENT_RESOLVER_NOT_FOUND: {
    kind: 'internal',
    userMessage: '无法读取该资料的内容来源，请重启应用后重试。',
    retryable: true,
    logLevel: 'error',
  },
  REGISTRATION_CONFLICT: {
    kind: 'internal',
    userMessage: '应用扩展发生冲突，请重启应用后重试。',
    retryable: false,
    logLevel: 'error',
  },
  INVALID_EXTENSION_DEFINITION: {
    kind: 'internal',
    userMessage: '应用扩展定义无效，请重启应用后重试。',
    retryable: false,
    logLevel: 'error',
  },
  FEATURE_NOT_SUPPORTED: {
    kind: 'user',
    userMessage: '该功能当前尚未开放。',
    retryable: false,
    logLevel: 'silent',
  },
  WORKBENCH_SESSION_NOT_FOUND: {
    kind: 'cancelled',
    retryable: false,
    logLevel: 'silent',
  },
  WORKBENCH_SESSION_EXPIRED: {
    kind: 'cancelled',
    retryable: false,
    logLevel: 'silent',
  },
  CONTENT_CHANGED_EXTERNALLY: {
    kind: 'user',
    userMessage:
      '文件已被其他程序修改。为避免覆盖外部更改，本次保存已取消。',
    retryable: true,
    logLevel: 'silent',
  },
  CONTENT_ENCODING_UNSUPPORTED: {
    kind: 'user',
    userMessage: '暂时无法识别或编辑该文本文件的编码。',
    retryable: false,
    logLevel: 'silent',
  },
  CONTENT_ENCODING_LOSS: {
    kind: 'user',
    userMessage:
      '新内容包含原文件编码无法表示的字符，本次保存已取消。',
    retryable: false,
    logLevel: 'silent',
  },
  CONTENT_WRITE_FAILED: {
    kind: 'user',
    userMessage: '无法写入文件，请检查文件权限后重试。',
    retryable: true,
    logLevel: 'warn',
  },
  ASSET_MEDIA_TYPE_MISMATCH: {
    kind: 'user',
    userMessage: '所选文件类型与原资料不一致，请重新选择同类型文件。',
    retryable: true,
    logLevel: 'silent',
  },
  ASSET_UNAVAILABLE: {
    kind: 'user',
    userMessage: '所选文件当前不可用，请检查文件是否存在以及访问权限。',
    retryable: true,
    logLevel: 'silent',
  },
  ASSET_NOT_FOUND: {
    kind: 'user',
    userMessage: '该资料已经不存在，请刷新资料列表。',
    retryable: true,
    logLevel: 'warn',
  },
  PROJECT_NOT_FOUND: {
    kind: 'user',
    userMessage: '该 Project 已经不存在，请返回首页刷新。',
    retryable: true,
    logLevel: 'warn',
  },
  INVALID_IPC_REQUEST: {
    kind: 'internal',
    userMessage: '应用请求无效，请重试。',
    retryable: true,
    logLevel: 'error',
  },
  DATABASE_WRITE_CONFLICT: {
    kind: 'internal',
    userMessage: '数据没有正确保存，请重试。',
    retryable: true,
    logLevel: 'error',
  },
  DATA_INTEGRITY_ERROR: {
    kind: 'internal',
    userMessage: '本地数据出现异常，请重启应用后重试。',
    retryable: true,
    logLevel: 'error',
  },
  SERVICE_NOT_READY: {
    kind: 'internal',
    userMessage: '功能尚未准备完成，请稍后重试。',
    retryable: true,
    logLevel: 'error',
  },
};

const internalErrorPolicy: ErrorPolicy = {
  kind: 'internal',
  userMessage: '操作没有完成，请稍后重试。',
  retryable: true,
  logLevel: 'error',
};

export class AppError extends Error {
  constructor(
    readonly code: AppErrorCode,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = 'AppError';
  }
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    error.name === 'AbortError'
  );
}

export function handleAppError(
  operation: string,
  error: unknown,
  logger: ErrorLogger = console,
): IpcErrorPayload {
  if (isAbortError(error)) {
    return {
      code: 'OPERATION_CANCELLED',
      kind: 'cancelled',
      retryable: false,
    };
  }

  const code = error instanceof AppError ? error.code : 'INTERNAL_ERROR';
  const policy =
    error instanceof AppError ? errorPolicies[error.code] : internalErrorPolicy;

  if (policy.logLevel === 'warn') {
    logger.warn(`[${operation}] ${code}`, error);
  } else if (policy.logLevel === 'error') {
    logger.error(`[${operation}] ${code}`, error);
  }

  return {
    code,
    kind: policy.kind,
    message: policy.userMessage,
    retryable: policy.retryable,
  };
}
