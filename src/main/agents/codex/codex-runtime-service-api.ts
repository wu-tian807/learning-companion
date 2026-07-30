import type {
  CodexAccountState,
  CodexLoginChallenge,
  CodexMcpServerPage,
  CodexModelPage,
  CodexRpcId,
  CodexRuntimeEvent,
  CodexRuntimeSnapshot,
  CodexSkillsByDirectory,
  CodexThread,
  CodexThreadPage,
  CodexThreadSelection,
  CodexTurnEvent,
  CodexTurnResult,
  CreateCodexThreadInput,
  InterruptCodexTurnInput,
  ListCodexThreadsInput,
  SelectCodexThreadInput,
  StartCodexTurnInput,
} from './codex-runtime-types';

export interface CodexRuntimeServiceApi {
  getSnapshot(): CodexRuntimeSnapshot;
  subscribe(listener: (event: CodexRuntimeEvent) => void): () => void;
  ensureReady(): Promise<CodexRuntimeSnapshot>;

  getAccount(refreshToken?: boolean): Promise<CodexAccountState>;
  startChatGptLogin(
    flow?: 'browser' | 'device-code',
  ): Promise<CodexLoginChallenge>;
  cancelLogin(loginId: string): Promise<void>;
  logout(): Promise<void>;

  listModels(input?: {
    readonly cursor?: string;
    readonly limit?: number;
    readonly includeHidden?: boolean;
  }): Promise<CodexModelPage>;
  getRateLimits(): Promise<unknown>;
  listSkills(
    cwds: readonly string[],
    forceReload?: boolean,
  ): Promise<readonly CodexSkillsByDirectory[]>;
  listMcpServers(input?: {
    readonly cursor?: string;
    readonly limit?: number;
    readonly threadId?: string;
    readonly detail?: 'full' | 'toolsAndAuthOnly';
  }): Promise<CodexMcpServerPage>;
  reloadMcpServers(): Promise<void>;

  createThread(
    input: CreateCodexThreadInput,
  ): Promise<CodexThreadSelection>;
  listThreads(
    input?: ListCodexThreadsInput,
  ): Promise<CodexThreadPage>;
  selectThread(
    input: SelectCodexThreadInput,
  ): Promise<CodexThreadSelection>;
  readThread(
    threadId: string,
    includeTurns?: boolean,
  ): Promise<CodexThread>;

  startTurn(
    input: StartCodexTurnInput,
  ): AsyncGenerator<CodexTurnEvent, CodexTurnResult>;
  interruptTurn(input: InterruptCodexTurnInput): Promise<void>;
  respondToServerRequest(
    requestId: CodexRpcId,
    response:
      | { readonly result: unknown }
      | {
          readonly error: {
            readonly code: number;
            readonly message: string;
            readonly data?: unknown;
          };
        },
  ): Promise<void>;

  shutdown(): Promise<void>;
}
