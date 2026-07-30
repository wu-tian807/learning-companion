import { EventEmitter } from 'node:events';
import type {
  ChildProcessByStdio,
} from 'node:child_process';
import { PassThrough } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import {
  CodexJsonRpcConnection,
  CodexRpcError,
} from './codex-rpc-connection';

type TestChild = ChildProcessByStdio<
  PassThrough,
  PassThrough,
  PassThrough
>;

function createChild(): TestChild {
  const child = new EventEmitter() as TestChild;
  Object.assign(child, {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    pid: 1234,
    exitCode: null,
    signalCode: null,
    kill: vi.fn(() => true),
  });
  return child;
}

function collectWrites(stream: PassThrough): string[] {
  const writes: string[] = [];
  stream.setEncoding('utf8');
  stream.on('data', (content: string) => {
    writes.push(content);
  });
  return writes;
}

function createConnection() {
  const child = createChild();
  const terminate = vi.fn(
    (_child: TestChild, _force: boolean) => {
      void _child;
      void _force;
      queueMicrotask(() => {
        child.emit('close', 0, null);
      });
    },
  );
  const connection = new CodexJsonRpcConnection(child, {
    terminate,
  });

  return { child, connection, terminate };
}

describe('CodexJsonRpcConnection', () => {
  it('multiplexes requests and resolves matching responses', async () => {
    const { child, connection } = createConnection();
    const writes = collectWrites(child.stdin);

    const response = connection.request<{ readonly ok: boolean }>(
      'account/read',
      { refreshToken: false },
    );
    await vi.waitFor(() => {
      expect(writes).toHaveLength(1);
    });
    expect(JSON.parse(writes[0])).toEqual({
      id: 1,
      method: 'account/read',
      params: { refreshToken: false },
    });

    child.stdout.write('{"id":1,"result":{"ok":true}}\n');

    await expect(response).resolves.toEqual({ ok: true });
    await connection.close();
  });

  it('delivers notifications and server-initiated requests', async () => {
    const { child, connection } = createConnection();
    const listener = vi.fn();
    const writes = collectWrites(child.stdin);
    connection.subscribe(listener);

    child.stdout.write(
      '{"method":"account/updated","params":{"authMode":"chatgpt"}}\n',
    );
    child.stdout.write(
      '{"id":"approval-1","method":"item/tool/call","params":{"threadId":"thread-1"}}\n',
    );

    await vi.waitFor(() => {
      expect(listener).toHaveBeenCalledTimes(2);
    });
    expect(listener).toHaveBeenNthCalledWith(1, {
      type: 'notification',
      method: 'account/updated',
      params: { authMode: 'chatgpt' },
    });
    expect(listener).toHaveBeenNthCalledWith(2, {
      type: 'server-request',
      id: 'approval-1',
      method: 'item/tool/call',
      params: { threadId: 'thread-1' },
    });

    await connection.respond('approval-1', {
      contentItems: [],
      success: true,
    });
    await vi.waitFor(() => {
      expect(writes).toHaveLength(1);
    });
    expect(JSON.parse(writes[0])).toEqual({
      id: 'approval-1',
      result: {
        contentItems: [],
        success: true,
      },
    });
    await connection.close();
  });

  it('preserves app-server RPC errors', async () => {
    const { child, connection } = createConnection();
    const request = connection.request('thread/read', {
      threadId: 'missing',
    });
    child.stdout.write(
      '{"id":1,"error":{"code":-32602,"message":"invalid thread","data":{"field":"threadId"}}}\n',
    );

    await expect(request).rejects.toEqual(
      expect.objectContaining<CodexRpcError>({
        name: 'CodexRpcError',
        code: -32602,
        message: 'invalid thread',
        data: { field: 'threadId' },
      }),
    );
    await connection.close();
  });

  it('treats malformed stdout as a fatal protocol error', async () => {
    const { child, connection, terminate } = createConnection();
    const request = connection.request('model/list', {});

    child.stdout.write('not-json\n');

    await expect(request).rejects.toThrow(
      'Codex app-server emitted invalid JSON',
    );
    expect(terminate).toHaveBeenCalledWith(child, true);
    await connection.closed;
  });
});
