import type { JsonValue } from '../../../shared/workbench/protocol';
import type { PreparedGenerationAssetReferenceBindings } from '../../../main/generation/contracts/generation-asset-reference';
import type {
  GenerationTaskPostProcessContext,
  GenerationTaskPostProcessor,
} from '../../../main/generation/contracts/task-definition';
import type { MindMapGenerationInstruction } from './mindmap-generation-instruction';
import type { MindMapGenerationCandidateV1 } from './mindmap-generation-output';

export type MindMapGenerationTaskResult = JsonValue & {
  readonly resultAssetId: string;
};

export interface MindMapGenerationResultCommitter {
  commit(input: {
    readonly taskId: string;
    readonly projectId: string;
    readonly candidate: MindMapGenerationCandidateV1;
    readonly assetReferences: PreparedGenerationAssetReferenceBindings;
    readonly signal?: AbortSignal;
  }): Promise<MindMapGenerationTaskResult>;
}

export class MindMapGenerationPostProcessor
  implements
    GenerationTaskPostProcessor<
      MindMapGenerationInstruction,
      JsonValue,
      MindMapGenerationCandidateV1,
      MindMapGenerationTaskResult
    >
{
  constructor(
    private readonly committer: MindMapGenerationResultCommitter,
  ) {}

  postProcess(
    context: GenerationTaskPostProcessContext<
      MindMapGenerationInstruction,
      JsonValue
    >,
    output: MindMapGenerationCandidateV1,
  ): Promise<MindMapGenerationTaskResult> {
    return this.committer.commit({
      taskId: context.taskId,
      projectId: context.projectId,
      candidate: output,
      assetReferences: context.assetReferences,
      ...(context.signal ? { signal: context.signal } : {}),
    });
  }
}
