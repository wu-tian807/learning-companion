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
  | 'CONTENT_HAS_UNSAVED_CHANGES'
  | 'CONTENT_ENCODING_UNSUPPORTED'
  | 'CONTENT_ENCODING_LOSS'
  | 'CONTENT_WRITE_FAILED'
  | 'ASSET_MEDIA_TYPE_MISMATCH'
  | 'ASSET_UNAVAILABLE'
  | 'ASSET_NOT_FOUND'
  | 'ATTACHMENT_NOT_FOUND'
  | 'ATTACHMENT_TYPE_NOT_REGISTERED'
  | 'ATTACHMENT_METADATA_INVALID'
  | 'ATTACHMENT_ANCHOR_INVALID'
  | 'PROJECT_NOT_FOUND'
  | 'PROJECT_WORKSPACE_UNAVAILABLE'
  | 'PROJECT_WORKSPACE_CONFLICT'
  | 'FILE_IMPORT_FAILED'
  | 'EXTERNAL_LIBRARY_NOT_INSTALLED'
  | 'EXTERNAL_LIBRARY_INSTALL_FAILED'
  | 'EXTERNAL_LIBRARY_INTEGRITY_FAILED'
  | 'EXTERNAL_LIBRARY_CONFLICT'
  | 'EXTERNAL_LIBRARY_MIGRATION_FAILED'
  | 'OFFICE_PREVIEW_FAILED'
  | 'CODEX_RUNTIME_UNAVAILABLE'
  | 'CODEX_PROTOCOL_ERROR'
  | 'CODEX_REQUEST_FAILED'
  | 'GENERATION_OUTPUT_INVALID'
  | 'CODEX_TURN_ACTIVE'
  | 'AGENT_PROVIDER_NOT_FOUND'
  | 'AGENT_PROVIDER_SELECTION_REQUIRED'
  | 'AGENT_PROVIDER_AUTH_REQUIRED'
  | 'AGENT_SESSION_CONFLICT'
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

export interface AppErrorDescription {
  readonly code: string;
  readonly kind: IpcErrorKind;
  readonly userMessage?: string;
  readonly retryable: boolean;
  readonly detail?: string;
}

const MAX_ERROR_DETAIL_LENGTH = 2_000;

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
  CONTENT_HAS_UNSAVED_CHANGES: {
    kind: 'user',
    userMessage:
      '存在未保存的编辑内容，请先保存或放弃当前修改后再切换编码。',
    retryable: false,
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
  ATTACHMENT_NOT_FOUND: {
    kind: 'user',
    userMessage: '该标注已经不存在，请刷新后重试。',
    retryable: true,
    logLevel: 'warn',
  },
  ATTACHMENT_TYPE_NOT_REGISTERED: {
    kind: 'internal',
    userMessage: '标注类型尚未注册，请重启应用后重试。',
    retryable: false,
    logLevel: 'error',
  },
  ATTACHMENT_METADATA_INVALID: {
    kind: 'internal',
    userMessage: '标注内容格式无效，请重试。',
    retryable: true,
    logLevel: 'error',
  },
  ATTACHMENT_ANCHOR_INVALID: {
    kind: 'internal',
    userMessage: '标注位置无效，请重新选择内容。',
    retryable: true,
    logLevel: 'error',
  },
  PROJECT_NOT_FOUND: {
    kind: 'user',
    userMessage: '该 Project 已经不存在，请返回首页刷新。',
    retryable: true,
    logLevel: 'warn',
  },
  PROJECT_WORKSPACE_UNAVAILABLE: {
    kind: 'user',
    userMessage: 'Project 工作区不可用，请检查目录是否存在以及读写权限。',
    retryable: true,
    logLevel: 'silent',
  },
  PROJECT_WORKSPACE_CONFLICT: {
    kind: 'user',
    userMessage: '所选目录已绑定到另一个 Project，请选择其他目录。',
    retryable: true,
    logLevel: 'silent',
  },
  FILE_IMPORT_FAILED: {
    kind: 'user',
    userMessage: '资料复制失败，请检查源文件和 Project 工作区权限。',
    retryable: true,
    logLevel: 'warn',
  },
  EXTERNAL_LIBRARY_NOT_INSTALLED: {
    kind: 'user',
    userMessage: '所需的外部组件尚未安装。',
    retryable: true,
    logLevel: 'silent',
  },
  EXTERNAL_LIBRARY_INSTALL_FAILED: {
    kind: 'user',
    userMessage: '外部组件安装失败，请检查网络、磁盘空间和目录权限后重试。',
    retryable: true,
    logLevel: 'warn',
  },
  EXTERNAL_LIBRARY_INTEGRITY_FAILED: {
    kind: 'user',
    userMessage: '外部组件下载校验失败，已丢弃不可信文件，请重试。',
    retryable: true,
    logLevel: 'warn',
  },
  EXTERNAL_LIBRARY_CONFLICT: {
    kind: 'user',
    userMessage: '目标目录中存在无法识别的同名组件，请先处理目录冲突。',
    retryable: true,
    logLevel: 'silent',
  },
  EXTERNAL_LIBRARY_MIGRATION_FAILED: {
    kind: 'user',
    userMessage: '外部组件迁移没有完成，应用仍将使用原目录。',
    retryable: true,
    logLevel: 'warn',
  },
  OFFICE_PREVIEW_FAILED: {
    kind: 'user',
    userMessage:
      'Office 预览生成失败，请重试。原文件没有被修改。',
    retryable: true,
    logLevel: 'warn',
  },
  CODEX_RUNTIME_UNAVAILABLE: {
    kind: 'user',
    userMessage: 'AI 服务暂时无法启动，请稍后重试。',
    retryable: true,
    logLevel: 'warn',
  },
  CODEX_PROTOCOL_ERROR: {
    kind: 'internal',
    userMessage: 'AI 服务通信异常，请重启应用后重试。',
    retryable: true,
    logLevel: 'error',
  },
  CODEX_REQUEST_FAILED: {
    kind: 'user',
    userMessage: 'AI 请求没有完成，请稍后重试。',
    retryable: true,
    logLevel: 'warn',
  },
  GENERATION_OUTPUT_INVALID: {
    kind: 'user',
    userMessage: 'AI 生成的文件未通过校验。',
    retryable: true,
    logLevel: 'warn',
  },
  CODEX_TURN_ACTIVE: {
    kind: 'user',
    userMessage: '当前对话仍在处理中，请等待完成或先停止。',
    retryable: true,
    logLevel: 'silent',
  },
  AGENT_PROVIDER_NOT_FOUND: {
    kind: 'internal',
    userMessage: '所选 AI Provider 不可用，请刷新后重试。',
    retryable: true,
    logLevel: 'error',
  },
  AGENT_PROVIDER_SELECTION_REQUIRED: {
    kind: 'user',
    userMessage: '请先在设置中选择一个可用的 AI Provider。',
    retryable: true,
    logLevel: 'silent',
  },
  AGENT_PROVIDER_AUTH_REQUIRED: {
    kind: 'user',
    userMessage: '请先完成该 AI Provider 的登录验证。',
    retryable: true,
    logLevel: 'silent',
  },
  AGENT_SESSION_CONFLICT: {
    kind: 'internal',
    userMessage: 'AI 会话映射发生冲突，请重建会话后重试。',
    retryable: true,
    logLevel: 'error',
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

function normalizedErrorDetail(value: string): string | undefined {
  const normalized = value.trim();

  if (normalized.length === 0) {
    return undefined;
  }

  return normalized.length <= MAX_ERROR_DETAIL_LENGTH
    ? normalized
    : `${normalized.slice(0, MAX_ERROR_DETAIL_LENGTH - 1)}…`;
}

function deepestErrorDetail(
  error: unknown,
  ignoredMessages: ReadonlySet<string>,
): string | undefined {
  const visited = new Set<Error>();
  let current = error;
  let detail: string | undefined;

  while (current instanceof Error && !visited.has(current)) {
    visited.add(current);
    const candidate = normalizedErrorDetail(current.message);

    if (candidate && !ignoredMessages.has(candidate)) {
      detail = candidate;
    }
    current = current.cause;
  }

  return detail;
}

export function describeAppError(error: unknown): AppErrorDescription {
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
  const ignoredMessages = new Set(
    [code, policy.userMessage].filter(
      (message): message is string => message !== undefined,
    ),
  );
  const detail = deepestErrorDetail(error, ignoredMessages);

  return {
    code,
    kind: policy.kind,
    userMessage: policy.userMessage,
    retryable: policy.retryable,
    ...(detail ? { detail } : {}),
  };
}

export function handleAppError(
  operation: string,
  error: unknown,
  logger: ErrorLogger = console,
): IpcErrorPayload {
  const description = describeAppError(error);
  const code = description.code;

  if (code === 'OPERATION_CANCELLED') {
    return {
      code,
      kind: description.kind,
      retryable: description.retryable,
    };
  }

  const policy =
    error instanceof AppError ? errorPolicies[error.code] : internalErrorPolicy;

  if (policy.logLevel === 'warn') {
    logger.warn(`[${operation}] ${code}`, error);
  } else if (policy.logLevel === 'error') {
    logger.error(`[${operation}] ${code}`, error);
  }

  return {
    code,
    kind: description.kind,
    message: description.userMessage,
    retryable: description.retryable,
  };
}
