import { describe, expect, it, vi } from 'vitest';

import { createTextAgentUserMessage } from '../../../main/generation/contracts/agent-message';
import type {
  TaskAgentCallRequest,
  TaskAgentSession,
  GenerationTaskProcessContext,
} from '../../../main/generation/contracts/task-definition';
import { WorkbenchConversationContextProviderRegistry } from '../../../main/conversation/workbench-conversation-context-provider-registry';
import type { LearningOutlineServiceApi } from '../service/learning-outline-service';
import { LEARNING_OUTLINE_INTAKE_MODE_ID } from '../shared';
import { LearningOutlineIntakeInstruction } from './learning-outline-intake-instruction';
import { createLearningOutlineIntakeTaskDefinitionV1 } from './learning-outline-intake-task-definition';

function textContent(message: TaskAgentCallRequest['userMessage']): string {
  return message.content
    .filter(
      (part): part is { type: 'text'; text: string } => part.type === 'text',
    )
    .map((part) => part.text)
    .join('\n');
}

function createCallResult(request: TaskAgentCallRequest) {
  return {
    callKey: request.callKey,
    purpose: request.purpose,
    sessionId: 'session-1',
    assistantOutput: '已收到需求。',
    metrics: {
      callKey: request.callKey,
      purpose: request.purpose,
      sessionId: 'session-1',
      providerId: 'provider-1',
      connectionId: 'connection-1',
      modelId: 'model-1',
      startedTime: 1,
      completedTime: 2,
      activeDurationMs: 1,
      turnCount: 1,
      repairTurnCount: 0,
    },
  };
}

function createProcessContext(
  call: TaskAgentSession['call'],
): GenerationTaskProcessContext<LearningOutlineIntakeInstruction> {
  return {
    taskId: 'task-1',
    projectId: 'project-1',
    instruction: new LearningOutlineIntakeInstruction({
      conversationId: 'conversation-1',
      boundAssetId: 'outline-1',
      question: '请结合当前资料整理我的学习目标。',
      contextSource: { contextProviderId: 'test.materials' },
    }),
    workspaces: {
      primary: {
        key: 'learning-outline-intake',
        instanceKey: 'conversation-1',
        path: 'C:/workspace/conversation-1',
        permissions: { read: true, write: false },
      },
      secondary: [
        {
          key: 'learning-outline-brief',
          instanceKey: 'outline-1',
          path: 'C:/workspace/outline-1',
          permissions: { read: true, write: true },
        },
      ],
    },
    preparedUserMessage: createTextAgentUserMessage(
      '用户问题：请结合当前资料整理我的学习目标。\n\n' +
        '正式来源清单（必须保留）：path="references/formal-mindmap/source.json"',
    ),
    assetReferences: {
      source: [
        {
          alias: 'formal-mindmap',
          assetId: 'mindmap-1',
          name: '正式思维导图',
          mediaType: 'application/json',
          contentRevision: 'revision-1',
          relativePath: 'references/formal-mindmap/source.json',
        },
      ],
    },
    agent: {
      completedCalls: [],
      call,
    },
    reportStatus: vi.fn(),
    reportOutputRejected: vi.fn(),
  };
}

function createOutlineService(): LearningOutlineServiceApi {
  return {
    runBriefTask: vi.fn(async (_assetId, operation) => operation()),
    requireBoundConversation: vi.fn(() => ({
      id: 'conversation-1',
      modeId: LEARNING_OUTLINE_INTAKE_MODE_ID,
    })),
    startBriefMonitor: vi.fn(async () => undefined),
    flushBrief: vi.fn(async () => undefined),
  } as unknown as LearningOutlineServiceApi;
}

describe('Learning Outline intake task definition', () => {
  it.each([
    {
      name: 'temporary text',
      message: createTextAgentUserMessage(
        '临时材料：references/temporary-document/source.md',
      ),
    },
    {
      name: 'temporary image',
      message: {
        role: 'user' as const,
        content: [
          { type: 'text' as const, text: '临时材料：当前选区' },
          {
            type: 'local-image' as const,
            path: 'C:/workspace/temporary/selected-region.png',
            detail: 'original' as const,
          },
        ],
      },
    },
  ])(
    'keeps formal source prompts with $name materials',
    async ({ message }) => {
      const providers = new WorkbenchConversationContextProviderRegistry();
      providers.register({
        id: 'test.materials',
        prepareMaterials: async () => ({
          userMessage: message,
          toolRequirements: [],
        }),
        prepare: async () => {
          throw new Error('not used');
        },
      });
      const call = vi.fn(async (request: TaskAgentCallRequest) =>
        createCallResult(request),
      );
      const definition = createLearningOutlineIntakeTaskDefinitionV1(
        providers,
        createOutlineService(),
      );

      await definition.process(createProcessContext(call));

      const prepared = call.mock.calls[0]?.[0].userMessage;
      expect(prepared).toBeDefined();
      const text = textContent(prepared!);
      expect(text).toContain('references/formal-mindmap/source.json');
      expect(text).toContain('临时材料');
      expect(
        text.indexOf('references/formal-mindmap/source.json'),
      ).toBeLessThan(text.indexOf('临时材料'));
      expect(
        prepared?.content.some((part) => part.type === 'local-image'),
      ).toBe(message.content.some((part) => part.type === 'local-image'));
    },
  );
});
