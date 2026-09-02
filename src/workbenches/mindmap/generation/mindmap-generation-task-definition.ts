import {
  MIND_MAP_GENERATION_TASK_DEFINITION_ID,
  MIND_MAP_GENERATION_TASK_DEFINITION_VERSION,
  MIND_MAP_GENERATION_TASK_DEFINITION_VERSION_V1,
  MIND_MAP_GENERATION_TASK_DEFINITION_VERSION_V2,
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
import { HIGH_INTELLIGENCE_AGENT_PROVIDER_SELECTOR_ID } from '../../../shared/agent-provider-selectors';

export {
  MIND_MAP_GENERATION_TASK_DEFINITION_ID,
  MIND_MAP_GENERATION_TASK_DEFINITION_VERSION,
  MIND_MAP_GENERATION_TASK_DEFINITION_VERSION_V1,
  MIND_MAP_GENERATION_TASK_DEFINITION_VERSION_V2,
} from '../../../shared/generation-definitions';

function createMindMapGenerationTaskDefinition(
  version: number,
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
    version,
    providerSelectorId: HIGH_INTELLIGENCE_AGENT_PROVIDER_SELECTOR_ID,
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

export function createMindMapGenerationTaskDefinitionV1(
  processor: GenerationTaskProcessor<
    MindMapGenerationInstruction,
    MindMapGenerationTaskResult
  >,
): TaskDefinition<
  MindMapGenerationInstruction,
  MindMapGenerationTaskResult
> {
  return createMindMapGenerationTaskDefinition(
    MIND_MAP_GENERATION_TASK_DEFINITION_VERSION_V1,
    processor,
  );
}

export function createMindMapGenerationTaskDefinitionV2(
  processor: GenerationTaskProcessor<
    MindMapGenerationInstruction,
    MindMapGenerationTaskResult
  >,
): TaskDefinition<
  MindMapGenerationInstruction,
  MindMapGenerationTaskResult
> {
  return createMindMapGenerationTaskDefinition(
    MIND_MAP_GENERATION_TASK_DEFINITION_VERSION_V2,
    processor,
  );
}

export function createMindMapGenerationTaskDefinitionV3(
  processor: GenerationTaskProcessor<
    MindMapGenerationInstruction,
    MindMapGenerationTaskResult
  >,
): TaskDefinition<
  MindMapGenerationInstruction,
  MindMapGenerationTaskResult
> {
  return createMindMapGenerationTaskDefinition(
    MIND_MAP_GENERATION_TASK_DEFINITION_VERSION,
    processor,
  );
}
