import { AppError } from '../errors/app-error';
import {
  cloneAgentUserMessage,
  type AgentUserMessage,
} from '../generation/contracts/agent-message';
import type {
  GenerationTaskProcessContext,
  TaskDefinition,
} from '../generation/contracts/task-definition';
import { MEDIUM_INTELLIGENCE_AGENT_PROVIDER_SELECTOR_ID } from '../../shared/agent-provider-selectors';
import {
  WORKBENCH_CONVERSATION_SOURCE_SLOT,
  WORKBENCH_CONVERSATION_TASK_DEFINITION_ID,
  WORKBENCH_CONVERSATION_TASK_DEFINITION_VERSION,
  type WorkbenchConversationTaskResult,
} from '../../shared/workbench-conversation';
import type { JsonValue } from '../../shared/workbench/protocol';
import { WorkbenchConversationContextProviderRegistry } from './workbench-conversation-context-provider-registry';
import {
  WorkbenchConversationInstruction,
  workbenchConversationInstructionFactory,
} from './workbench-conversation-instruction';

const DEFAULT_MAXIMUM_ANSWER_LENGTH = 32_768;

function appendTitleRequest(
  message: AgentUserMessage,
  generateTitle: boolean,
): AgentUserMessage {
  if (!generateTitle) return cloneAgentUserMessage(message);
  return cloneAgentUserMessage({
    role: 'user',
    content: [
      ...message.content,
      {
        type: 'text',
        text: '这是本次对话的第一个问题。请先输出一行 <conversation-title>简短主题</conversation-title>，主题不超过 16 个汉字，然后再输出正常回答。',
      },
    ],
  });
}

function parseAssistantOutput(
  output: string | undefined,
  maximumLength: number,
): { readonly answer: string; readonly title?: string } {
  const normalized = output?.trim();
  const titleMatch = normalized?.match(
    /^<conversation-title>([^<>\r\n]+)<\/conversation-title>\s*/u,
  );
  const title = titleMatch?.[1]?.trim().slice(0, 32);
  const answer = titleMatch
    ? normalized?.slice(titleMatch[0].length).trim()
    : normalized;
  if (!answer || answer.length > maximumLength) {
    throw new AppError('GENERATION_OUTPUT_INVALID', {
      cause: new Error('Workbench Conversation 最终回答为空或长度超出限制'),
    });
  }
  return Object.freeze({ answer, ...(title ? { title } : {}) });
}

export function createWorkbenchConversationTaskDefinitionV1(
  providers: WorkbenchConversationContextProviderRegistry,
): TaskDefinition<
  WorkbenchConversationInstruction,
  WorkbenchConversationTaskResult
> {
  return Object.freeze({
    id: WORKBENCH_CONVERSATION_TASK_DEFINITION_ID,
    version: WORKBENCH_CONVERSATION_TASK_DEFINITION_VERSION,
    providerSelectorId: MEDIUM_INTELLIGENCE_AGENT_PROVIDER_SELECTOR_ID,
    primaryWorkspaceConfig: Object.freeze({
      key: 'workbench-conversation',
      permissions: Object.freeze({ read: true, write: false }),
      resolveInstanceKey: ({ instruction }: { instruction: JsonValue }) => {
        const parsed = workbenchConversationInstructionFactory.parse(
          instruction,
        );
        if (!parsed.ok) {
          throw new Error('Invalid Workbench Conversation instruction');
        }
        return parsed.value.conversationId;
      },
    }),
    secondaryWorkspaceConfigs: Object.freeze([]),
    assetReferenceSchema: Object.freeze({
      [WORKBENCH_CONVERSATION_SOURCE_SLOT]: Object.freeze({
        required: false,
        cardinality: 'one' as const,
        minItems: 0,
        maxItems: 1,
      }),
    }),
    instruction: workbenchConversationInstructionFactory,
    async process(
      context: GenerationTaskProcessContext<WorkbenchConversationInstruction>,
    ) {
      context.signal?.throwIfAborted();
      const provider = providers.require(context.instruction.contextProviderId);
      const prepared = await provider.prepare(context);
      context.signal?.throwIfAborted();
      context.reportStatus(prepared.statusMessage);
      const call = await context.agent.call({
        callKey: 'answer',
        purpose: prepared.purpose,
        systemInstruction: prepared.systemInstruction,
        userMessage: appendTitleRequest(
          prepared.userMessage,
          context.instruction.generateTitle,
        ),
        toolRequirements: prepared.toolRequirements,
        skills: prepared.skills ?? [],
        mcpServers: prepared.mcpServers ?? [],
        assistantEvents: 'runtime',
      });
      context.signal?.throwIfAborted();
      const { answer, title } = parseAssistantOutput(
        call.assistantOutput,
        prepared.maximumAnswerLength ?? DEFAULT_MAXIMUM_ANSWER_LENGTH,
      );

      let contextResult: JsonValue | undefined;
      if (context.instruction.commitAnswer) {
        if (!provider.commitAnswer) {
          throw new AppError('INVALID_EXTENSION_DEFINITION');
        }
        if (prepared.commitStatusMessage) {
          context.reportStatus(prepared.commitStatusMessage);
        }
        contextResult = await provider.commitAnswer(context, {
          answer,
          ...(title ? { title } : {}),
          call,
        });
        context.signal?.throwIfAborted();
      }

      return Object.freeze({
        answer,
        ...(title ? { title } : {}),
        providerId: call.metrics.providerId,
        modelId: call.metrics.modelId,
        ...(contextResult === undefined ? {} : { contextResult }),
      }) as WorkbenchConversationTaskResult;
    },
  });
}
