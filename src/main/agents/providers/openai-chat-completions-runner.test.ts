import { join } from 'node:path';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { describe, expect, it, vi } from 'vitest';

import type {
  GenerationAgentTurnRequest,
  GenerationAgentTurnResult,
} from '../../generation/generation-agent-runner';
import {
  OpenAiChatCompletionsRunner,
  type OpenAiChatHistoryMessage,
} from './openai-chat-completions-runner';

function turnRequest(
  overrides: Partial<GenerationAgentTurnRequest> = {},
): GenerationAgentTurnRequest {
  return {
    taskId: 'task-1',
    callKey: 'answer',
    projectId: 'project-1',
    sessionLocator: {
      projectId: 'project-1',
      workspaceKey: 'workbench-conversation',
      instanceKey: 'conversation-1',
    },
    modelId: 'deepseek-v4-flash-vision-exp',
    systemInstruction: '你是识图助手。',
    userMessage: {
      role: 'user',
      content: [{ type: 'text', text: '图里写了什么？' }],
    },
    toolRequirements: [],
    skills: [],
    mcpServers: [],
    workspaces: {
      primary: {
        key: 'workbench-conversation',
        instanceKey: 'conversation-1',
        path: join('workspace'),
        permissions: { read: true, write: false },
      },
      secondary: [],
    },
    ...overrides,
  } as never;
}

function sseChunks(payloads: readonly string[]): AsyncIterable<Uint8Array> {
  return {
    async *[Symbol.asyncIterator]() {
      yield new TextEncoder().encode(payloads.join(''));
    },
  };
}

function createFetch(
  body: AsyncIterable<Uint8Array>,
  requestLog: unknown[],
) {
  return vi.fn(async (url: string, init: RequestInit) => {
    requestLog.push({ url, init });
    return {
      ok: true,
      status: 200,
      body,
      text: async () => '',
    };
  });
}

async function collectTurn(
  runner: OpenAiChatCompletionsRunner,
  request: GenerationAgentTurnRequest,
): Promise<{
  readonly events: readonly string[];
  readonly result: GenerationAgentTurnResult;
}> {
  const events: string[] = [];
  const iterator = runner.runTurn(request)[Symbol.asyncIterator]();
  let step = await iterator.next();
  while (!step.done) {
    events.push(step.value.type);
    step = await iterator.next();
  }
  return { events, result: step.value };
}

describe('OpenAiChatCompletionsRunner', () => {
  it('streams a text completion and stores conversation history', async () => {
    const histories = new Map<
      string,
      readonly OpenAiChatHistoryMessage[]
    >();
    const requestLog: unknown[] = [];
    const runner = new OpenAiChatCompletionsRunner(
      {
        providerId: 'codex',
        connectionId: 'connection-1',
        baseUrl: 'https://api.deepseek.com/',
        apiKey: 'secret-key',
        histories,
      },
      {
        now: () => 1_000,
        fetchImpl: createFetch(
          sseChunks([
            'data: {"id":"resp-1","choices":[{"delta":{"content":"你好"}}]}\n\n',
            'data: {"id":"resp-1","choices":[{"delta":{"content":"世界"}}]}\n\n',
            'data: {"id":"resp-1","choices":[{"delta":{}}],"usage":{"prompt_tokens":4,"completion_tokens":6,"total_tokens":10}}\n\n',
            'data: [DONE]\n\n',
          ]),
          requestLog,
        ),
      },
    );

    const { events, result } = await collectTurn(
      runner,
      turnRequest(),
    );

    expect(result).toMatchObject({
      sessionId: expect.stringMatching(/^openai-chat-/u),
      assistantOutput: '你好世界',
      providerId: 'codex',
      connectionId: 'connection-1',
      modelId: 'deepseek-v4-flash-vision-exp',
      usage: {
        inputTokens: 4,
        outputTokens: 6,
        totalTokens: 10,
      },
    });
    expect(events).toEqual([
      'session-resolved',
      'assistant-delta',
      'assistant-delta',
      'usage-updated',
      'assistant-completed',
    ]);
    expect(requestLog[0]).toMatchObject({
      url: 'https://api.deepseek.com/chat/completions',
      init: expect.objectContaining({
        headers: {
          Authorization: 'Bearer secret-key',
          'Content-Type': 'application/json',
        },
      }),
    });

    const firstBody = JSON.parse(
      (requestLog[0] as { init: { body: string } }).init.body,
    );
    expect(firstBody.model).toBe('deepseek-v4-flash-vision-exp');
    expect(firstBody.messages.at(-1)).toEqual({
      role: 'user',
      content: [{ type: 'text', text: '图里写了什么？' }],
    });

    await collectTurn(
      runner,
      turnRequest({
        taskId: 'task-2',
        userMessage: {
          role: 'user',
          content: [{ type: 'text', text: '继续' }],
        },
      }),
    );
    expect(histories.size).toBe(1);
    const secondBody = JSON.parse(
      (requestLog[1] as { init: { body: string } }).init.body,
    );
    expect(secondBody.messages.at(-2)).toEqual({
      role: 'assistant',
      content: '你好世界',
    });
  });

  it('sends local images as base64 image_url parts', async () => {
    const requestLog: unknown[] = [];
    const runner = new OpenAiChatCompletionsRunner(
      {
        providerId: 'codex',
        connectionId: 'connection-1',
        baseUrl: 'https://api.deepseek.com',
        apiKey: 'secret-key',
        histories: new Map(),
      },
      {
        fetchImpl: createFetch(sseChunks([
          'data: {"id":"resp-2","choices":[{"delta":{"content":"这是一张图片"}}]}\n\n',
          'data: [DONE]\n\n',
        ]), requestLog),
        readFileImpl: vi.fn(async () => Buffer.from('png-bytes')),
      },
    );
    const path = join('workspace', 'references', 'source-0001', 'question-image.png');

    await collectTurn(
      runner,
      turnRequest({
        userMessage: {
          role: 'user',
          content: [
            { type: 'text', text: '图里是什么？' },
            { type: 'local-image', path, detail: 'high' },
          ],
        },
      }),
    );

    const body = JSON.parse(
      (requestLog[0] as { init: { body: string } }).init.body,
    );
    expect(body.messages.at(-1).content).toEqual(
      expect.arrayContaining([
        {
          type: 'image_url',
          image_url: {
            url: 'data:image/png;base64,cG5nLWJ5dGVz',
            detail: 'high',
          },
        },
      ]),
    );
  });

  it('rejects tool/skill requirements on the chat-completions channel', async () => {
    const runner = new OpenAiChatCompletionsRunner(
      {
        providerId: 'codex',
        connectionId: 'connection-1',
        baseUrl: 'https://api.deepseek.com',
        apiKey: 'secret-key',
        histories: new Map(),
      },
      {
        fetchImpl: createFetch(sseChunks([]), []),
      },
    );

    await expect(
      runner
        .runTurn(
          turnRequest({
            toolRequirements: [
              { id: 'workspace.view_image', availability: 'required' },
            ],
          }),
        )
        .next(),
    ).rejects.toMatchObject({ code: 'FEATURE_NOT_SUPPORTED' });
  });

  it('streams through the real Node fetch response body without locking', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      response.write(
        'data: {"id":"resp-live","choices":[{"delta":{"content":"真实流"}}]}\n\n',
      );
      response.end(
        'data: {"id":"resp-live","choices":[{"delta":{}}],"usage":{"total_tokens":9}}\n\ndata: [DONE]\n\n',
      );
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as AddressInfo;
    const runner = new OpenAiChatCompletionsRunner({
      providerId: 'codex',
      connectionId: 'connection-live',
      baseUrl: `http://127.0.0.1:${address.port}`,
      apiKey: 'secret-key',
      histories: new Map(),
    });

    try {
      const { result } = await collectTurn(
        runner,
        turnRequest({
          userMessage: {
            role: 'user',
            content: [{ type: 'text', text: '你好' }],
          },
        }),
      );
      expect(result.assistantOutput).toBe('真实流');
      expect(result.usage).toEqual({ totalTokens: 9 });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
