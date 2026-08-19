import { WORKBENCH_AGENT_PROVIDER_SELECTOR_ID } from '../../../../shared/agent-provider-selectors';
import type {
  GenerationTaskProcessContext,
  GenerationTaskProcessor,
  TaskDefinition,
} from '../../../../main/generation/contracts/task-definition';
import type { JsonValue } from '../../../../shared/workbench/protocol';
import {
  type EpubExplanationTaskResult,
  EPUB_EXPLANATION_TASK_DEFINITION_ID,
  EPUB_EXPLANATION_TASK_DEFINITION_VERSION,
} from '../shared';
import {
  EpubExplanationInstruction,
  epubExplanationInstructionFactory,
} from './instruction';

export function createEpubExplanationTaskDefinitionV1(
  processor: GenerationTaskProcessor<
    EpubExplanationInstruction,
    EpubExplanationTaskResult
  >,
): TaskDefinition<EpubExplanationInstruction, EpubExplanationTaskResult> {
  return Object.freeze({
    id: EPUB_EXPLANATION_TASK_DEFINITION_ID,
    version: EPUB_EXPLANATION_TASK_DEFINITION_VERSION,
    providerSelectorId: WORKBENCH_AGENT_PROVIDER_SELECTOR_ID,
    primaryWorkspaceConfig: Object.freeze({
      key: 'generation-epub-explanation',
      permissions: Object.freeze({ read: false, write: false }),
      resolveInstanceKey: ({
        taskId,
        instruction,
      }: {
        readonly taskId: string;
        readonly instruction: JsonValue;
      }) => {
        const parsed = epubExplanationInstructionFactory.parse(instruction);
        if (!parsed.ok) {
          throw new Error('Invalid EPUB explanation instruction');
        }
        return parsed.value.conversationId ?? taskId;
      },
    }),
    secondaryWorkspaceConfigs: Object.freeze([]),
    assetReferenceSchema: Object.freeze({}),
    instruction: epubExplanationInstructionFactory,
    process: (
      context: GenerationTaskProcessContext<EpubExplanationInstruction>,
    ) => processor.process(context),
  });
}
