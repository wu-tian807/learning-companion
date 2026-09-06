import { expect, it, vi } from 'vitest';
import { CodexAuthConnection } from './codex-auth-connection';
import type { CodexRpcConnectionApi } from './codex-rpc-connection';

function fixture() {
  const request = vi.fn(async (_method: string, _params?: unknown) => { void _method; void _params; return {}; });
  const execution: CodexRpcConnectionApi = {
    request: request as CodexRpcConnectionApi['request'], closed: new Promise(() => undefined),
    notify: vi.fn(async () => undefined), respond: vi.fn(async () => undefined),
    respondError: vi.fn(async () => undefined), close: vi.fn(async () => undefined), subscribe: vi.fn(() => vi.fn()),
  };
  const authFile = { prepare: vi.fn(async () => false), detach: vi.fn(async () => undefined), hasCredentials: vi.fn(async () => true) };
  return { request, execution, authFile, connection: new CodexAuthConnection(execution, authFile) };
}

it('reloads changed native credentials before a turn without sending credentials over RPC', async () => {
  const f = fixture(); f.authFile.prepare.mockResolvedValueOnce(true);
  await f.connection.request('turn/start', { threadId: 'lc-thread' });
  expect(f.request.mock.calls).toEqual([
    ['account/read', { refreshToken: true }], ['turn/start', { threadId: 'lc-thread' }, undefined],
  ]);
  await f.connection.request('model/list');
  expect(f.request).toHaveBeenCalledTimes(3);
  await f.connection.close();
});

it('detaches before login/logout so neither can modify the shared source', async () => {
  const f = fixture();
  f.request.mockImplementation(async () => { expect(f.authFile.detach).toHaveBeenCalled(); return {}; });
  await f.connection.request('account/login/start', { type: 'chatgpt' });
  await f.connection.request('account/logout');
  expect(f.authFile.detach).toHaveBeenCalledTimes(2);
  expect(f.authFile.prepare).not.toHaveBeenCalled();
  await f.connection.close();
});

it('retries failed native reload before allowing a turn to use the changed account', async () => {
  const f = fixture();
  f.authFile.prepare.mockResolvedValueOnce(true);
  f.request.mockRejectedValueOnce(new Error('temporary reload failure'));
  await expect(f.connection.request('turn/start')).rejects.toThrow('temporary reload failure');
  await f.connection.request('turn/start');
  expect(f.request.mock.calls).toEqual([
    ['account/read', { refreshToken: true }],
    ['account/read', { refreshToken: true }],
    ['turn/start', undefined, undefined],
  ]);
  await f.connection.close();
});

it('serializes credential checks, allows retry, and stops pending calls on disposal', async () => {
  const f = fixture();
  f.authFile.prepare.mockRejectedValueOnce(new Error('unavailable'));
  await expect(f.connection.request('thread/start')).rejects.toThrow('unavailable');
  await f.connection.request('thread/start');
  let release!: (changed: boolean) => void; let reading!: () => void;
  const started = new Promise<void>((resolve) => { reading = resolve; });
  f.authFile.prepare.mockImplementationOnce(() => { reading(); return new Promise((resolve) => { release = resolve; }); });
  const pending = f.connection.request('turn/start');
  const rejected = expect(pending).rejects.toMatchObject({ code: 'CODEX_RUNTIME_UNAVAILABLE' });
  await started; await f.connection.close(); release(true); await rejected;
  expect(f.request.mock.calls).toEqual([['thread/start', undefined, undefined]]);
});

it('does not reload native auth after disposal during a credential availability check', async () => {
  const f = fixture();
  f.authFile.prepare.mockResolvedValueOnce(true);
  let release!: (available: boolean) => void;
  let reading!: () => void;
  const started = new Promise<void>((resolve) => { reading = resolve; });
  f.authFile.hasCredentials.mockImplementationOnce(() => {
    reading();
    return new Promise((resolve) => { release = resolve; });
  });
  const rejected = expect(f.connection.request('turn/start')).rejects.toMatchObject({
    code: 'CODEX_RUNTIME_UNAVAILABLE',
  });
  await started;
  await f.connection.close();
  release(true);
  await rejected;
  expect(f.request).not.toHaveBeenCalled();
});
