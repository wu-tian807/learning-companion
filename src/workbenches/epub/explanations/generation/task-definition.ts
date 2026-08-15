import { WORKBENCH_AGENT_PROVIDER_SELECTOR_ID } from '../../../../shared/agent-provider-selectors';
import type {
  GenerationTaskProcessContext,
  GenerationTaskProcessor,
  TaskDefinition,
} from '../../../../main/generation/contracts/task-definition';
import {
  EPUB_EXPLANATION_TASK_DEFINITION_ID,
  EPUB_EXPLANATION_TASK_DEFINITION_VERSION,
} from '../shared';
import {
  EpubExplanationInstruction,
  epubExplanationInstructionFactory,
} from './instruction';
import type { EpubExplanationTaskResult } from './processor';

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
    }),
    secondaryWorkspaceConfigs: Object.freeze([]),
    assetReferenceSchema: Object.freeze({}),
    instruction: epubExplanationInstructionFactory,
    process: (
      context: GenerationTaskProcessContext<EpubExplanationInstruction>,
    ) => processor.process(context),
  });
}
