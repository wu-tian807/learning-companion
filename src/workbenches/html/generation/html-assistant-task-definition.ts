import {
  HTML_ASSISTANT_TASK_DEFINITION_ID,
  HTML_ASSISTANT_TASK_DEFINITION_VERSION,
} from '../../../shared/generation-definitions';
import { WORKBENCH_AGENT_PROVIDER_SELECTOR_ID } from '../../../shared/agent-provider-selectors';
import type {
  GenerationTaskProcessContext,
  GenerationTaskProcessor,
  TaskDefinition,
} from '../../../main/generation/contracts/task-definition';
import type { AgentWorkspaceInstanceContext } from '../../../main/generation/contracts/generation-workspace';
import {
  HtmlAssistantInstruction,
  htmlAssistantInstructionFactory,
} from './html-assistant-instruction';
import type { HtmlAssistantTaskResult } from './html-assistant-result';

export {
  HTML_ASSISTANT_TASK_DEFINITION_ID,
  HTML_ASSISTANT_TASK_DEFINITION_VERSION,
} from '../../../shared/generation-definitions';

export function createHtmlAssistantTaskDefinitionV1(
  processor: GenerationTaskProcessor<
    HtmlAssistantInstruction,
    HtmlAssistantTaskResult
  >,
): TaskDefinition<HtmlAssistantInstruction, HtmlAssistantTaskResult> {
  return Object.freeze({
    id: HTML_ASSISTANT_TASK_DEFINITION_ID,
    version: HTML_ASSISTANT_TASK_DEFINITION_VERSION,
    providerSelectorId: WORKBENCH_AGENT_PROVIDER_SELECTOR_ID,
    primaryWorkspaceConfig: Object.freeze({
      key: 'html-assistant',
      permissions: Object.freeze({ read: true, write: false }),
      resolveInstanceKey({ instruction }: AgentWorkspaceInstanceContext) {
        const parsed = htmlAssistantInstructionFactory.parse(instruction);
        if (!parsed.ok) {
          throw new Error('HtmlAssistant instruction 数据无效');
        }
        return parsed.value.conversationId;
      },
    }),
    secondaryWorkspaceConfigs: Object.freeze([]),
    assetReferenceSchema: Object.freeze({
      sources: Object.freeze({
        required: true,
        cardinality: 'one' as const,
        minItems: 1,
      }),
    }),
    instruction: htmlAssistantInstructionFactory,
    process: (
      context: GenerationTaskProcessContext<HtmlAssistantInstruction>,
    ) => processor.process(context),
  });
}
