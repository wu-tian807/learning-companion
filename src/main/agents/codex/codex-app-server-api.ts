import { AppError } from '../../errors/app-error';
import { toThreadConfiguration } from './codex-runtime-params';
import type {
  CodexAccountState,
  CodexLoginChallenge,
  CodexMcpServerPage,
  CodexModelPage,
  CodexSkillsByDirectory,
  CodexThread,
  CodexThreadPage,
  CodexThreadSelection,
  CreateCodexThreadInput,
  InterruptCodexTurnInput,
  ListCodexThreadsInput,
  SelectCodexThreadInput,
} from './codex-runtime-types';
import {
  isRecord,
  requireAbsolutePath,
  requireNonEmptyString,
  requireThread,
} from './codex-runtime-validation';

export type CodexAppServerRequester = <TResult>(
  method: string,
  params?: unknown,
) => Promise<TResult>;

export class CodexAppServerApi {
  constructor(private readonly request: CodexAppServerRequester) {}

  async getAccount(
    refreshToken = false,
  ): Promise<CodexAccountState> {
    const result = await this.request<unknown>('account/read', {
      refreshToken,
    });

    if (
      !isRecord(result) ||
      !(
        result.account === null ||
        (isRecord(result.account) &&
          typeof result.account.type === 'string')
      ) ||
      typeof result.requiresOpenaiAuth !== 'boolean'
    ) {
      throw new AppError('CODEX_PROTOCOL_ERROR');
    }

    return result as unknown as CodexAccountState;
  }

  async startChatGptLogin(
    flow: 'browser' | 'device-code' = 'browser',
  ): Promise<CodexLoginChallenge> {
    const params =
      flow === 'browser'
        ? {
            type: 'chatgpt',
            useHostedLoginSuccessPage: true,
            appBrand: 'chatgpt',
          }
        : { type: 'chatgptDeviceCode' };
    const result = await this.request<unknown>(
      'account/login/start',
      params,
    );

    if (
      !isRecord(result) ||
      typeof result.type !== 'string' ||
      typeof result.loginId !== 'string'
    ) {
      throw new AppError('CODEX_PROTOCOL_ERROR');
    }

    if (
      result.type === 'chatgpt' &&
      typeof result.authUrl === 'string'
    ) {
      return {
        type: 'chatgpt',
        loginId: result.loginId,
        authUrl: result.authUrl,
      };
    }

    if (
      result.type === 'chatgptDeviceCode' &&
      typeof result.verificationUrl === 'string' &&
      typeof result.userCode === 'string'
    ) {
      return {
        type: 'chatgptDeviceCode',
        loginId: result.loginId,
        verificationUrl: result.verificationUrl,
        userCode: result.userCode,
      };
    }

    throw new AppError('CODEX_PROTOCOL_ERROR');
  }

  async cancelLogin(loginId: string): Promise<void> {
    await this.request('account/login/cancel', {
      loginId: requireNonEmptyString(loginId, 'loginId'),
    });
  }

  async logout(): Promise<void> {
    await this.request('account/logout');
  }

  async listModels(
    input: {
      readonly cursor?: string;
      readonly limit?: number;
      readonly includeHidden?: boolean;
    } = {},
  ): Promise<CodexModelPage> {
    const result = await this.request<unknown>('model/list', input);

    if (
      !isRecord(result) ||
      !Array.isArray(result.data) ||
      !(
        result.nextCursor === null ||
        typeof result.nextCursor === 'string'
      )
    ) {
      throw new AppError('CODEX_PROTOCOL_ERROR');
    }

    return result as unknown as CodexModelPage;
  }

  getRateLimits(): Promise<unknown> {
    return this.request('account/rateLimits/read');
  }

  async listSkills(
    cwds: readonly string[],
    forceReload = false,
  ): Promise<readonly CodexSkillsByDirectory[]> {
    const result = await this.request<unknown>('skills/list', {
      cwds: cwds.map((cwd) => requireAbsolutePath(cwd, 'skills.cwd')),
      forceReload,
    });

    if (!isRecord(result) || !Array.isArray(result.data)) {
      throw new AppError('CODEX_PROTOCOL_ERROR');
    }

    return result.data as unknown as readonly CodexSkillsByDirectory[];
  }

  async listMcpServers(
    input: {
      readonly cursor?: string;
      readonly limit?: number;
      readonly threadId?: string;
      readonly detail?: 'full' | 'toolsAndAuthOnly';
    } = {},
  ): Promise<CodexMcpServerPage> {
    const result = await this.request<unknown>(
      'mcpServerStatus/list',
      input,
    );

    if (
      !isRecord(result) ||
      !Array.isArray(result.data) ||
      !(
        result.nextCursor === null ||
        typeof result.nextCursor === 'string'
      )
    ) {
      throw new AppError('CODEX_PROTOCOL_ERROR');
    }

    return result as unknown as CodexMcpServerPage;
  }

  async reloadMcpServers(): Promise<void> {
    await this.request('config/mcpServer/reload');
  }

  async createThread(
    input: CreateCodexThreadInput,
  ): Promise<CodexThreadSelection> {
    const result = await this.request<unknown>('thread/start', {
      ...toThreadConfiguration(input),
      serviceName: input.serviceName ?? 'learning_companion',
      ephemeral: input.ephemeral,
      dynamicTools: input.dynamicTools,
    });

    return this.requireThreadSelection(result);
  }

  async listThreads(
    input: ListCodexThreadsInput = {},
  ): Promise<CodexThreadPage> {
    const result = await this.request<unknown>('thread/list', {
      cursor: input.cursor,
      limit: input.limit,
      archived: input.archived,
      cwd:
        typeof input.cwd === 'string'
          ? requireAbsolutePath(input.cwd, 'thread.list.cwd')
          : input.cwd?.map((cwd) =>
              requireAbsolutePath(cwd, 'thread.list.cwd'),
            ),
      searchTerm: input.searchTerm,
      useStateDbOnly: input.useStateDbOnly,
    });

    if (
      !isRecord(result) ||
      !Array.isArray(result.data) ||
      !(
        result.nextCursor === null ||
        typeof result.nextCursor === 'string'
      )
    ) {
      throw new AppError('CODEX_PROTOCOL_ERROR');
    }

    for (const thread of result.data) {
      requireThread(thread);
    }

    return result as unknown as CodexThreadPage;
  }

  async selectThread(
    input: SelectCodexThreadInput,
  ): Promise<CodexThreadSelection> {
    const result = await this.request<unknown>('thread/resume', {
      threadId: requireNonEmptyString(input.threadId, 'threadId'),
      ...toThreadConfiguration(input),
      excludeTurns: input.excludeTurns,
    });

    return this.requireThreadSelection(result);
  }

  async readThread(
    threadId: string,
    includeTurns = false,
  ): Promise<CodexThread> {
    const result = await this.request<unknown>('thread/read', {
      threadId: requireNonEmptyString(threadId, 'threadId'),
      includeTurns,
    });

    if (!isRecord(result)) {
      throw new AppError('CODEX_PROTOCOL_ERROR');
    }

    return requireThread(result.thread);
  }

  async interruptTurn(
    input: InterruptCodexTurnInput,
  ): Promise<void> {
    await this.request('turn/interrupt', {
      threadId: requireNonEmptyString(input.threadId, 'threadId'),
      turnId: requireNonEmptyString(input.turnId, 'turnId'),
    });
  }

  private requireThreadSelection(
    value: unknown,
  ): CodexThreadSelection {
    if (!isRecord(value)) {
      throw new AppError('CODEX_PROTOCOL_ERROR');
    }

    requireThread(value.thread);
    return value as unknown as CodexThreadSelection;
  }
}
