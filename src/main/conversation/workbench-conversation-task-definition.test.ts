import { describe, expect, it, vi } from 'vitest';

import {
  LOW_INTELLIGENCE_AGENT_PROVIDER_SELECTOR_ID,
  MEDIUM_INTELLIGENCE_AGENT_PROVIDER_SELECTOR_ID,
} from '../../shared/agent-provider-selectors';
import { DOCUMENT_CONVERSATION_CONTEXT_PROVIDER_ID } from '../../workbenches/document-ai/document-conversation-context';
import { IMAGE_CONVERSATION_CONTEXT_PROVIDER_ID } from '../../workbenches/image/explanations/image-conversation-context';
import { createTextAgentUserMessage } from '../generation/contracts/agent-message';
import { WorkbenchConversationContextProviderRegistry } from './workbench-conversation-context-provider-registry';
import { WorkbenchConversationInstruction } from './workbench-conversation-instruction';
import { createWorkbenchConversationTaskDefinitionV1 } from './workbench-conversation-task-definition';

function instruction(input: {
  readonly commitAnswer?: boolean;
  readonly generateTitle?: boolean;
  readonly workspace?: Readonly<{ instanceKey: string }>;
} = {}) {
  return new WorkbenchConversationInstruction({
    contextProviderId: 'test.context',
    assetId: 'asset-1',
    conversationId: 'conversation-stable',
    question: '解释这里',
    context: { selection: '内容' },
    ...input,
  });
}

function setup(input: {
  readonly assistantOutput?: string;
  readonly commitAnswer?: boolean;
  readonly generateTitle?: boolean;
} = {}) {
  const prepare = vi.fn(async () => ({
    purpose: 'test-conversation',
    statusMessage: '正在回答…',
    systemInstruction: 'system',
    userMessage: createTextAgentUserMessage('prepared'),
    toolRequirements: [],
    commitStatusMessage: '正在保存…',
  }));
  const commitAnswer = vi.fn(async () => ({ attachmentId: 'attachment-1' }));
  const registry = new WorkbenchConversationContextProviderRegistry();
  registry.register({ id: 'test.context', prepare, commitAnswer });
  const definition = createWorkbenchConversationTaskDefinitionV1(registry);
  const call = vi.fn(async () => ({
    callKey: 'answer',
    purpose: 'test-conversation',
    sessionId: 'session-1',
    assistantOutput: input.assistantOutput ?? '最终回答',
    metrics: { providerId: 'codex', modelId: 'gpt-test' },
  }));
  const reportStatus = vi.fn();
  const context = {
    taskId: 'task-1',
    projectId: 'project-1',
    instruction: instruction({
      commitAnswer: input.commitAnswer,
      generateTitle: input.generateTitle,
    }),
    workspaces: {
      primary: {
        key: 'workbench-conversation',
        instanceKey: 'conversation-stable',
        path: 'C:\\workspace',
        permissions: { read: true, write: false },
      },
      secondary: [],
    },
    assetReferences: {},
    preparedUserMessage: createTextAgentUserMessage('unused'),
    agent: { completedCalls: [], call },
    reportStatus,
    reportOutputRejected: vi.fn(),
  } as never;
  return { definition, context, call, prepare, commitAnswer, reportStatus };
}

describe('shared Workbench conversation TaskDefinition', () => {
  it('uses conversationId as the stable Provider Session partition', () => {
    const { definition } = setup();
    const resolve = definition.primaryWorkspaceConfig.resolveInstanceKey!;
    const snapshot = instruction().toSnapshot();

    expect(resolve({ taskId: 'task-1', instruction: snapshot })).toBe(
      'conversation-stable',
    );
    expect(resolve({ taskId: 'task-2', instruction: snapshot })).toBe(
      'conversation-stable',
    );
  });

  it('routes visual conversations to the low-intensity vision selector', () => {
    const { definition } = setup();
    const imageSnapshot = new WorkbenchConversationInstruction({
      contextProviderId: IMAGE_CONVERSATION_CONTEXT_PROVIDER_ID,
      conversationId: 'conversation-1',
      question: '图里是什么',
    }).toSnapshot();
    const markdownImageSnapshot = new WorkbenchConversationInstruction({
      contextProviderId: DOCUMENT_CONVERSATION_CONTEXT_PROVIDER_ID,
      conversationId: 'conversation-1',
      question: '解释这张图',
      context: {
        target: { scope: 'asset' },
        image: { relativePath: 'images/shot.png' },
      },
    }).toSnapshot();
    const textSnapshot = new WorkbenchConversationInstruction({
      contextProviderId: DOCUMENT_CONVERSATION_CONTEXT_PROVIDER_ID,
      conversationId: 'conversation-1',
      question: '解释这段文字',
      context: {
        target: { scope: 'asset' },
        selectedText: '段落',
      },
    }).toSnapshot();

    expect(definition.resolveProviderSelectorId?.(imageSnapshot)).toBe(
      LOW_INTELLIGENCE_AGENT_PROVIDER_SELECTOR_ID,
    );
    expect(definition.resolveProviderSelectorId?.(markdownImageSnapshot)).toBe(
      LOW_INTELLIGENCE_AGENT_PROVIDER_SELECTOR_ID,
    );
    expect(definition.resolveProviderSelectorId?.(textSnapshot)).toBeUndefined();
    expect(definition.providerSelectorId).toBe(
      MEDIUM_INTELLIGENCE_AGENT_PROVIDER_SELECTOR_ID,
    );
  });

  it('lets a conversation mode select a stable workspace instance', () => {
    const { definition } = setup();
    const resolve = definition.primaryWorkspaceConfig.resolveInstanceKey!;
    const snapshot = instruction({
      workspace: { instanceKey: 'outline-draft-1' },
    }).toSnapshot();

    expect(resolve({ taskId: 'task-1', instruction: snapshot })).toBe(
      'outline-draft-1',
    );
    expect(definition.primaryWorkspaceConfig.permissions).toEqual({
      read: true,
      write: false,
    });
  });

  it('runs one provider-prepared Agent turn and returns the common result', async () => {
    const { definition, context, call, prepare, commitAnswer, reportStatus } =
      setup({
        assistantOutput:
          '<conversation-title>选区解释</conversation-title>\n这是回答。',
        generateTitle: true,
      });

    await expect(definition.process(context)).resolves.toEqual({
      answer: '这是回答。',
      title: '选区解释',
      providerId: 'codex',
      modelId: 'gpt-test',
    });
    expect(prepare).toHaveBeenCalledWith(context);
    expect(call).toHaveBeenCalledWith(
      expect.objectContaining({
        callKey: 'answer',
        purpose: 'test-conversation',
        systemInstruction: 'system',
        assistantEvents: 'runtime',
      }),
    );
    expect(reportStatus).toHaveBeenCalledWith('正在回答…');
    expect(commitAnswer).not.toHaveBeenCalled();
  });

  it('commits optional Workbench side effects only after a valid answer', async () => {
    const { definition, context, commitAnswer, reportStatus } = setup({
      commitAnswer: true,
    });

    await expect(definition.process(context)).resolves.toMatchObject({
      answer: '最终回答',
      contextResult: { attachmentId: 'attachment-1' },
    });
    expect(commitAnswer).toHaveBeenCalledOnce();
    expect(reportStatus.mock.calls).toEqual([
      ['正在回答…'],
      ['正在保存…'],
    ]);
  });

  it('rejects an empty or overlong final answer before committing', async () => {
    const empty = setup({ assistantOutput: '   ', commitAnswer: true });
    await expect(empty.definition.process(empty.context)).rejects.toMatchObject({
      code: 'GENERATION_OUTPUT_INVALID',
    });
    expect(empty.commitAnswer).not.toHaveBeenCalled();

    const overlong = setup({
      assistantOutput: 'x'.repeat(32_769),
      commitAnswer: true,
    });
    await expect(
      overlong.definition.process(overlong.context),
    ).rejects.toMatchObject({ code: 'GENERATION_OUTPUT_INVALID' });
    expect(overlong.commitAnswer).not.toHaveBeenCalled();
  });
});
