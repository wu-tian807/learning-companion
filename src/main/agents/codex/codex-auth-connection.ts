import { AppError } from '../../errors/app-error';
import type { CodexAppServerConnectionFactoryApi } from './codex-app-server-process';
import type { CodexAuthFileLink } from './codex-auth-file-link';
import type { CodexRpcConnectionApi, CodexRpcIncomingEvent } from './codex-rpc-connection';
import type { CodexRpcId } from './codex-runtime-types';

const AUTHENTICATED_METHODS = new Set([
  'account/read', 'account/rateLimits/read', 'model/list',
  'thread/start', 'thread/resume', 'thread/fork', 'turn/start',
]);

// No token-bearing RPCs: Codex owns the linked file and its native refresh flow.
export class CodexAuthConnection implements CodexRpcConnectionApi {
  readonly closed: CodexRpcConnectionApi['closed'];
  private stopped = false;
  private authReloadPending = false;
  private tail: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly execution: CodexRpcConnectionApi,
    private readonly authFile: Pick<CodexAuthFileLink, 'prepare' | 'detach' | 'hasCredentials'>,
  ) {
    this.closed = execution.closed;
    void this.closed.then(() => { this.stopped = true; });
  }

  async request<T>(method: string, params?: unknown, timeoutMs?: number): Promise<T> {
    this.assertOpen();
    const detach = method === 'account/login/start' || method === 'account/logout';
    if (detach || AUTHENTICATED_METHODS.has(method)) {
      const prepared = this.tail.then(async () => {
        this.assertOpen();
        if (detach) await this.authFile.detach();
        const changed = detach || await this.authFile.prepare();
        this.authReloadPending ||= changed;
        this.assertOpen();
        if (this.authReloadPending) {
          // account/read does not clear Codex's cached auth when its file was
          // removed. Explicitly clear only the isolated process in that case.
          const hasCredentials = await this.authFile.hasCredentials();
          this.assertOpen();
          if (hasCredentials) {
            await this.execution.request('account/read', { refreshToken: true });
          } else {
            await this.execution.request('account/logout');
          }
          // Keep this pending on failure: prepare already recorded the file
          // version, but native auth may still contain the previous account.
          this.authReloadPending = false;
        }
      });
      this.tail = prepared.catch(() => undefined);
      await prepared;
    }
    this.assertOpen();
    return this.execution.request<T>(method, params, timeoutMs);
  }

  notify(method: string, params?: unknown): Promise<void> { return this.execution.notify(method, params); }
  respond(id: CodexRpcId, result: unknown): Promise<void> { return this.execution.respond(id, result); }
  respondError(id: CodexRpcId, error: { code: number; message: string; data?: unknown }): Promise<void> {
    return this.execution.respondError(id, error);
  }
  subscribe(listener: (event: CodexRpcIncomingEvent) => void): () => void { return this.execution.subscribe(listener); }
  close(): Promise<void> { this.stopped = true; return this.execution.close(); }
  private assertOpen(): void { if (this.stopped) throw new AppError('CODEX_RUNTIME_UNAVAILABLE'); }
}

export class CodexAuthConnectionFactory implements CodexAppServerConnectionFactoryApi {
  constructor(
    private readonly execution: CodexAppServerConnectionFactoryApi,
    private readonly authFile: CodexAuthFileLink,
  ) {}

  async connect(): Promise<CodexRpcConnectionApi> {
    await this.authFile.prepare();
    return new CodexAuthConnection(await this.execution.connect(), this.authFile);
  }
}
