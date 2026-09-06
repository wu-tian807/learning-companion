import { describe, expect, it, vi } from 'vitest';

import { createTextAgentUserMessage } from '../../../main/generation/contracts/agent-message';
import type {
  TaskAgentCallRequest,
  TaskAgentSession,
  GenerationTaskProcessContext,
} from '../../../main/generation/contracts/task-definition';
import { WorkbenchConversationContextProviderRegistry } from '../../../main/conversation/workbench-conversation-context-provider-registry';
import type { LearningOutlineServiceApi } from '../service/learning-outline-service';
import { createEmptyLearningBrief, LEARNING_BRIEF_COMPLETION_NOTICE, LEARNING_BRIEF_SCHEMA,
  LEARNING_OUTLINE_INTAKE_MODE_ID, type LearningOutlineBriefState } from '../shared';
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
    getBriefState: vi.fn(() => ({ valid: true, ready: false, brief: createEmptyLearningBrief() })),
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

function plainContext(call: TaskAgentSession['call']) {
  return { ...createProcessContext(call), instruction: new LearningOutlineIntakeInstruction({
    conversationId: 'conversation-1', boundAssetId: 'outline-1', question: '继续整理需求。',
  }) };
}

function completeState(): LearningOutlineBriefState {
  return { valid: true, ready: true, brief: { ...createEmptyLearningBrief(),
    goal: '读懂论文', currentLevel: '基础了解', difficulties: '暂无', constraints: '每周两天',
    preferences: '实践', scope: '核心方法', roadmap: [{ id: 'week-1', title: '基础' }],
    readiness: 'ready', readinessNote: '必填信息已明确。',
  } };
}

describe('Intake validation feedback and completion', () => {
  it('supplies the full file contract and repairs invalid output before announcing completion', async () => {
    let state: LearningOutlineBriefState = { valid: true, brief: createEmptyLearningBrief() };
    const service = createOutlineService();
    vi.mocked(service.getBriefState).mockImplementation(() => state);
    const call = vi.fn(async (request: TaskAgentCallRequest) => {
      state = request.callKey === 'answer'
        ? { valid: false, error: 'roadmap[0].id：缺少标识；roadmap[0].title：缺少标题' }
        : completeState();
      return { ...createCallResult(request), assistantOutput: request.callKey === 'answer'
        ? '<conversation-title>学习计划</conversation-title>草稿已填写。' : '已整理四周路线。' };
    });
    const result = await createLearningOutlineIntakeTaskDefinitionV1(new WorkbenchConversationContextProviderRegistry(), service).process(plainContext(call));
    expect(call.mock.calls.map(([request]) => request.callKey)).toEqual(['answer', 'repair-brief-1']);
    expect(call.mock.calls[0]![0].systemInstruction).toContain(JSON.stringify(LEARNING_BRIEF_SCHEMA, null, 2));
    expect(textContent(call.mock.calls[1]![0].userMessage)).toContain('roadmap[0].id');
    expect(call.mock.calls[1]![0].assistantEvents).toBe('none');
    expect(result).toMatchObject({ title: '学习计划', answer: `已整理四周路线。\n\n${LEARNING_BRIEF_COMPLETION_NOTICE}` });
  });

  it('corrects a premature ready claim by asking about a missing required field', async () => {
    const full = completeState().brief!;
    let state: LearningOutlineBriefState = { valid: true, ready: false,
      brief: { ...full, difficulties: '', readiness: 'ready' } };
    const service = createOutlineService();
    vi.mocked(service.getBriefState).mockImplementation(() => state);
    const call = vi.fn(async (request: TaskAgentCallRequest) => {
      if (request.callKey.startsWith('repair')) state = { ...state, brief: { ...state.brief!, readiness: 'collecting' } };
      return { ...createCallResult(request), assistantOutput: request.callKey === 'answer' ? '可以生成了。' : '你目前遇到的主要困难是什么？没有也可以直接告诉我。' };
    });
    const result = await createLearningOutlineIntakeTaskDefinitionV1(new WorkbenchConversationContextProviderRegistry(), service).process(plainContext(call));
    expect(textContent(call.mock.calls[1]![0].userMessage)).toContain('困难');
    expect(result.answer).toContain('主要困难');
    expect(result.answer).not.toContain(LEARNING_BRIEF_COMPLETION_NOTICE);
  });

  it('bounds failed repairs and never returns a false completion claim', async () => {
    const service = createOutlineService();
    vi.mocked(service.getBriefState).mockReturnValue({ valid: false, error: 'roadmap[0].title：缺少标题' });
    const call = vi.fn(async (request: TaskAgentCallRequest) => ({ ...createCallResult(request), assistantOutput: '所有必填项已填写完成。' }));
    const result = await createLearningOutlineIntakeTaskDefinitionV1(new WorkbenchConversationContextProviderRegistry(), service).process(plainContext(call));
    expect(call).toHaveBeenCalledTimes(3);
    expect(result.answer).toContain('暂时不能确认填写完成');
    expect(result.answer).not.toContain('所有必填项已填写完成');
  });

  it('allows additional detailed information after completion without requiring another repair', async () => {
    const service = createOutlineService();
    const state = completeState();
    vi.mocked(service.getBriefState).mockReturnValue({ ...state, brief: { ...state.brief!, detailed: '希望配套例子。' } });
    const call = vi.fn(async (request: TaskAgentCallRequest) => ({ ...createCallResult(request), assistantOutput: `补充已保存。\n\n${LEARNING_BRIEF_COMPLETION_NOTICE}` }));
    const result = await createLearningOutlineIntakeTaskDefinitionV1(new WorkbenchConversationContextProviderRegistry(), service).process(plainContext(call));
    expect(call).toHaveBeenCalledOnce();
    expect(result.answer.split(LEARNING_BRIEF_COMPLETION_NOTICE)).toHaveLength(2);
    expect(call.mock.calls[0]![0].systemInstruction).toContain('不要为了填 detailed 追问');
  });

  it('uses the checkpointed repaired answer when resuming after the file is already valid', async () => {
    const service = createOutlineService();
    vi.mocked(service.getBriefState).mockReturnValue(completeState());
    const call = vi.fn(async (request: TaskAgentCallRequest) => createCallResult(request));
    const context = plainContext(call);
    const repair = { ...createCallResult({ callKey: 'repair-brief-1', purpose: 'learning-outline-intake-repair' } as TaskAgentCallRequest), assistantOutput: '恢复的最终答复。' };
    const result = await createLearningOutlineIntakeTaskDefinitionV1(new WorkbenchConversationContextProviderRegistry(), service).process({ ...context, agent: { call, completedCalls: [repair] } });
    expect(call).toHaveBeenCalledOnce();
    expect(result.answer).toContain('恢复的最终答复');
  });

  it('honors cancellation during repair and does not report completion', async () => {
    const service = createOutlineService();
    vi.mocked(service.getBriefState).mockReturnValue({ valid: false, error: 'invalid' });
    const controller = new AbortController();
    const call = vi.fn(async (request: TaskAgentCallRequest) => {
      if (request.callKey.startsWith('repair')) controller.abort();
      return createCallResult(request);
    });
    await expect(createLearningOutlineIntakeTaskDefinitionV1(new WorkbenchConversationContextProviderRegistry(), service).process({ ...plainContext(call), signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(call).toHaveBeenCalledTimes(2);
  });
});
