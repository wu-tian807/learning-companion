import {
  MIND_MAP_GENERATION_TASK_DEFINITION_ID,
  MIND_MAP_GENERATION_TASK_DEFINITION_VERSION,
} from '../../../shared/generation-definitions';
import type {
  GenerationTaskProcessContext,
  GenerationTaskProcessor,
  TaskDefinition,
} from '../../../main/generation/contracts/task-definition';
import {
  MindMapGenerationInstruction,
  mindMapGenerationInstructionFactory,
} from './mindmap-generation-instruction';
import type { MindMapGenerationTaskResult } from './mindmap-generation-processor';
import { GENERATION_CENTER_AGENT_PROVIDER_SELECTOR_ID } from '../../../shared/agent-provider-selectors';

export {
  MIND_MAP_GENERATION_TASK_DEFINITION_ID,
  MIND_MAP_GENERATION_TASK_DEFINITION_VERSION,
} from '../../../shared/generation-definitions';

export function createMindMapGenerationTaskDefinitionV1(
  processor: GenerationTaskProcessor<
    MindMapGenerationInstruction,
    MindMapGenerationTaskResult
  >,
): TaskDefinition<
  MindMapGenerationInstruction,
  MindMapGenerationTaskResult
> {
  return Object.freeze({
    id: MIND_MAP_GENERATION_TASK_DEFINITION_ID,
    version: MIND_MAP_GENERATION_TASK_DEFINITION_VERSION,
    providerSelectorId: GENERATION_CENTER_AGENT_PROVIDER_SELECTOR_ID,
    primaryWorkspaceConfig: Object.freeze({
      key: 'generation-mindmap',
      permissions: Object.freeze({ read: true, write: true }),
    }),
    secondaryWorkspaceConfigs: Object.freeze([]),
    assetReferenceSchema: Object.freeze({
      sources: Object.freeze({
        required: true,
        cardinality: 'many' as const,
        minItems: 1,
      }),
    }),
    instruction: mindMapGenerationInstructionFactory,
    process: (
      context: GenerationTaskProcessContext<MindMapGenerationInstruction>,
    ) => processor.process(context),
  });
}
