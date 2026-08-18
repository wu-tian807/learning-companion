import type {
  GenerationTaskProcessContext,
  GenerationTaskProcessor,
  TaskDefinition,
} from '../../../../main/generation/contracts/task-definition';
import type { JsonValue } from '../../../../shared/workbench/protocol';
import { WORKBENCH_AGENT_PROVIDER_SELECTOR_ID } from '../../../../shared/agent-provider-selectors';
import {
  IMAGE_EXPLANATION_TASK_DEFINITION_ID,
  IMAGE_EXPLANATION_TASK_DEFINITION_VERSION,
} from '../shared';
import {
  ImageExplanationInstruction,
  imageExplanationInstructionFactory,
} from './instruction';
import type { ImageExplanationTaskResult } from '../shared';

export function createImageExplanationTaskDefinitionV1(
  processor: GenerationTaskProcessor<
    ImageExplanationInstruction,
    ImageExplanationTaskResult
  >,
): TaskDefinition<ImageExplanationInstruction, ImageExplanationTaskResult> {
  return Object.freeze({
    id: IMAGE_EXPLANATION_TASK_DEFINITION_ID,
    version: IMAGE_EXPLANATION_TASK_DEFINITION_VERSION,
    providerSelectorId: WORKBENCH_AGENT_PROVIDER_SELECTOR_ID,
    primaryWorkspaceConfig: Object.freeze({
      key: 'generation-image-explanation',
      permissions: Object.freeze({ read: true, write: false }),
      resolveInstanceKey: ({
        taskId,
        instruction,
      }: {
        readonly taskId: string;
        readonly instruction: JsonValue;
      }) => {
        const parsed = imageExplanationInstructionFactory.parse(instruction);
        if (!parsed.ok) throw new Error('Invalid image explanation instruction');
        return parsed.value.conversationId ?? taskId;
      },
    }),
    secondaryWorkspaceConfigs: Object.freeze([]),
    assetReferenceSchema: Object.freeze({
      image: Object.freeze({
        required: true,
        cardinality: 'one' as const,
        acceptedMediaTypes: Object.freeze([
          'image/png',
          'image/jpeg',
          'image/webp',
          'image/bmp',
        ]),
      }),
    }),
    instruction: imageExplanationInstructionFactory,
    process: (context: GenerationTaskProcessContext<ImageExplanationInstruction>) =>
      processor.process(context),
  });
}
