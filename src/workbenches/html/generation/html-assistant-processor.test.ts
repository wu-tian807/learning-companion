import { describe, expect, it, vi } from 'vitest';

import { createTextAgentUserMessage } from '../../../main/generation/contracts/agent-message';
import type {
  GenerationTaskProcessContext,
  TaskAgentCallResult,
  TaskAgentSession,
} from '../../../main/generation/contracts/task-definition';
import { createHtmlAssistantProcessor } from './html-assistant-processor';
import { HtmlAssistantInstruction } from './html-assistant-instruction';

function createContext(options: {
  readonly instruction?: HtmlAssistantInstruction;
  readonly agent?: Partial<TaskAgentSession>;
  readonly signal?: AbortSignal;
} = {}) {
  const instruction =
    options.instruction ??
    new HtmlAssistantInstruction({
      conversationId: 'conversation-1',
      question: '什么是自注意力？',
    });

  const agent: TaskAgentSession = {
    completedCalls: Object.freeze([]),
    call: vi.fn(async () =>
      Object.freeze({
        callKey: 'ask',
        purpose: 'answer',
        sessionId: 'thread-1',
        assistantOutput: Object.freeze({ text: '最终回答' }),
        metrics: Object.freeze({
          callKey: 'ask',
          purpose: 'answer',
          sessionId: 'thread-1',
          providerId: 'codex',
          modelId: 'model-1',
          startedTime: 0,
          completedTime: 1,
          activeDurationMs: 1,
          turnCount: 1,
          repairTurnCount: 0,
        }),
      } as TaskAgentCallResult),
    ),
    ...options.agent,
  };

  return {
    instruction,
    agent,
    context: {
      taskId: 'task-1',
      projectId: 'project-1',
      instruction,
      workspaces: Object.freeze({
        primary: Object.freeze({
          key: 'html-assistant',
          instanceKey: 'conversation-1',
          scope: 'named',
          permissions: Object.freeze({ read: true, write: false }),
          path: '/workspace/html-assistant/conversation-1',
        }),
        secondary: Object.freeze([]),
      }),
      assetReferences: Object.freeze({
        sources: Object.freeze([
          Object.freeze({
            alias: 'sources-0001',
            assetId: 'asset-1',
            name: 'lesson.html',
            mediaType: 'text/html',
            contentRevision: 'revision-1',
            relativePath: 'references/sources-0001/source.html',
          }),
        ]),
      }),
      defaultUserMessage: createTextAgentUserMessage('问题'),
      agent,
      reportStatus: vi.fn(),
      reportOutputRejected: vi.fn(),
      ...(options.signal ? { signal: options.signal } : {}),
    } as unknown as GenerationTaskProcessContext<HtmlAssistantInstruction>,
  };
}

describe('createHtmlAssistantProcessor', () => {
  it('calls the agent once with the ask call key', async () => {
    const { context, agent } = createContext();
    const processor = createHtmlAssistantProcessor();

    const result = await processor.process(context);

    expect(agent.call).toHaveBeenCalledTimes(1);
    expect(agent.call).toHaveBeenCalledWith(
      expect.objectContaining({
        callKey: 'ask',
        purpose: 'answer',
      }),
    );
    expect(result).toEqual({ answer: '最终回答' });
  });

  it('fails honestly when the provider completes without final output', async () => {
    const { context } = createContext({
      agent: {
        call: vi.fn(async () =>
          Object.freeze({
            callKey: 'ask',
            purpose: 'answer',
            sessionId: 'thread-1',
            metrics: {},
          } as TaskAgentCallResult),
        ),
      },
    });

    await expect(
      createHtmlAssistantProcessor().process(context),
    ).rejects.toThrow('未收到最终回答');
  });

  it('throws when aborted before the call', async () => {
    const controller = new AbortController();
    controller.abort();
    const { context } = createContext({ signal: controller.signal });

    await expect(
      createHtmlAssistantProcessor().process(context),
    ).rejects.toThrow();
  });
});
