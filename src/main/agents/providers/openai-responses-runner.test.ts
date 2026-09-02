import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { describe, expect, it, vi } from 'vitest';

import type { GenerationAgentTurnRequest } from '../../generation/generation-agent-runner';
import { OpenAiResponsesRunner } from './openai-responses-runner';

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
        path: 'C:\\workspace',
        permissions: { read: true, write: false },
      },
      secondary: [],
    },
    ...overrides,
  } as never;
}

async function collectTurn(
  runner: OpenAiResponsesRunner,
  request: GenerationAgentTurnRequest,
): Promise<{ readonly events: readonly string[]; readonly result: unknown }> {
  const events: string[] = [];
  const iterator = runner.runTurn(request)[Symbol.asyncIterator]();
  let step = await iterator.next();
  while (!step.done) {
    events.push(step.value.type);
    step = await iterator.next();
  }
  return { events, result: step.value };
}

describe('OpenAiResponsesRunner', () => {
  it('streams a final Responses answer and chains previous responses', async () => {
    const requests: unknown[] = [];
    const server = createServer((request, response) => {
      let body = '';
      request.on('data', (chunk) => {
        body += chunk;
      });
      request.on('end', () => {
        requests.push(body);
        response.writeHead(200, {
          'Content-Type': 'application/json',
        });
        response.end(
          JSON.stringify({
            id: 'response-live',
            object: 'response',
            output: [
              {
                type: 'message',
                content: [
                  { type: 'output_text', text: '图片内容是 PINK。' },
                ],
              },
            ],
            usage: {
              input_tokens: 10,
              output_tokens: 5,
              total_tokens: 15,
            },
          }),
        );
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as AddressInfo;
    const previousResponses = new Map<string, string>();
    const runner = new OpenAiResponsesRunner({
      providerId: 'codex',
      connectionId: 'connection-responses',
      baseUrl: `http://127.0.0.1:${address.port}`,
      apiKey: 'secret-key',
      previousResponses,
    });

    try {
      const first = await collectTurn(runner, turnRequest());
      expect(first.result).toMatchObject({
        assistantOutput: '图片内容是 PINK。',
        providerExecutionId: 'response-live',
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      });
      expect(first.events).toEqual([
        'session-resolved',
        'assistant-completed',
      ]);
      const firstBody = JSON.parse(requests[0] as string);
      expect(firstBody.model).toBe('deepseek-v4-flash-vision-exp');
      expect(firstBody).not.toHaveProperty('previous_response_id');

      await collectTurn(
        runner,
        turnRequest({
          taskId: 'task-2',
          userMessage: {
            role: 'user',
            content: [{ type: 'text', text: '再解释一下' }],
          },
        }),
      );
      const secondBody = JSON.parse(requests[1] as string);
      expect(secondBody.previous_response_id).toBe('response-live');
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it('sends local images as base64 input_image parts', async () => {
    const requests: unknown[] = [];
    const server = createServer((request, response) => {
      let body = '';
      request.on('data', (chunk) => {
        body += chunk;
      });
      request.on('end', () => {
        requests.push(body);
        response.writeHead(200, {
          'Content-Type': 'application/json',
        });
        response.end(
          JSON.stringify({
            id: 'response-image',
            output: [
              {
                type: 'message',
                content: [
                  { type: 'output_text', text: '看到图片了' },
                ],
              },
            ],
          }),
        );
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as AddressInfo;
    const runner = new OpenAiResponsesRunner(
      {
        providerId: 'codex',
        connectionId: 'connection-responses',
        baseUrl: `http://127.0.0.1:${address.port}`,
        apiKey: 'secret-key',
        previousResponses: new Map(),
      },
      {
        readFileImpl: vi.fn(async () => Buffer.from('png-bytes')),
      },
    );

    try {
      await collectTurn(
        runner,
        turnRequest({
          userMessage: {
            role: 'user',
            content: [
              { type: 'text', text: '图里是什么？' },
              {
                type: 'local-image',
                path: 'C:\\workspace\\question-image.png',
              },
            ],
          },
        }),
      );
      const body = JSON.parse(requests[0] as string);
      expect(body.input[0].content).toEqual(
        expect.arrayContaining([
          {
            type: 'input_image',
            image_url:
              'data:image/png;base64,cG5nLWJ5dGVz',
          },
        ]),
      );
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
