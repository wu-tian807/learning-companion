import type { AgentWorkspaceManagerApi } from '../../agents/workspaces/agent-workspace-manager';
import { AppError } from '../../errors/app-error';
import type { GenerationInstruction } from '../contracts/generation-instruction';
import type { AnyTaskDefinition } from '../contracts/task-definition';
import {
  prepareAgentWorkspace,
  type PreparedAgentWorkspaces,
} from '../contracts/generation-workspace';
import type { GenerationTaskSnapshot } from '../generation-task';
import type { GenerationAssetReferencePreparerApi } from './generation-asset-reference-preparer';
import { appendAssetReferencesToUserMessage } from './generation-user-message-composer';
import type { PreparedGenerationTask } from './prepared-generation-task';

export interface GenerationTaskPreparerApi {
  prepare(
    task: GenerationTaskSnapshot,
    definition: AnyTaskDefinition,
    signal?: AbortSignal,
  ): Promise<PreparedGenerationTask>;
  restore(
    task: GenerationTaskSnapshot,
    definition: AnyTaskDefinition,
    signal?: AbortSignal,
  ): Promise<PreparedGenerationTask>;
}

function parseInstruction(
  task: GenerationTaskSnapshot,
  definition: AnyTaskDefinition,
): GenerationInstruction {
  const parsed = definition.instruction.parse(task.instruction);

  if (!parsed.ok) {
    throw new Error(
      parsed.issues
        .map((issue) => `${issue.path}: ${issue.message}`)
        .join('\n'),
    );
  }

  return parsed.value;
}

function validateDefinitionIdentity(
  task: GenerationTaskSnapshot,
  definition: AnyTaskDefinition,
): void {
  if (
    definition.id !== task.definitionId ||
    definition.version !== task.definitionVersion
  ) {
    throw new AppError('INVALID_EXTENSION_DEFINITION');
  }
}

export class GenerationTaskPreparer implements GenerationTaskPreparerApi {
  constructor(
    private readonly workspaceManager: AgentWorkspaceManagerApi,
    private readonly assetReferencePreparer: GenerationAssetReferencePreparerApi,
  ) {}

  async prepare(
    task: GenerationTaskSnapshot,
    definition: AnyTaskDefinition,
    signal?: AbortSignal,
  ): Promise<PreparedGenerationTask> {
    signal?.throwIfAborted();
    validateDefinitionIdentity(task, definition);
    const instruction = parseInstruction(task, definition);
    const workspaces = await this.prepareWorkspaces(
      task,
      definition,
      instruction,
    );
    const assetReferences = await this.assetReferencePreparer.prepare(
      {
        projectId: task.projectId,
        schema: definition.assetReferenceSchema,
        bindings: task.assetReferences,
        primaryWorkspacePath: workspaces.primary.path,
      },
      signal,
    );
    signal?.throwIfAborted();

    return this.createPreparedRuntime(
      task,
      definition,
      instruction,
      workspaces,
      assetReferences,
    );
  }

  async restore(
    task: GenerationTaskSnapshot,
    definition: AnyTaskDefinition,
    signal?: AbortSignal,
  ): Promise<PreparedGenerationTask> {
    signal?.throwIfAborted();
    validateDefinitionIdentity(task, definition);

    if (!task.prepared) {
      throw new Error('GenerationTask 尚未完成 prepare');
    }

    const instruction = parseInstruction(task, definition);
    const workspaces = await this.prepareWorkspaces(
      task,
      definition,
      instruction,
    );
    const assetReferences = await this.assetReferencePreparer.verify(
      workspaces.primary.path,
      definition.assetReferenceSchema,
      task.prepared.assetReferences,
      signal,
    );

    return this.createPreparedRuntime(
      task,
      definition,
      instruction,
      workspaces,
      assetReferences,
    );
  }

  private async prepareWorkspaces(
    task: GenerationTaskSnapshot,
    definition: AnyTaskDefinition,
    instruction: GenerationInstruction,
  ): Promise<PreparedAgentWorkspaces> {
    const context = Object.freeze({
      taskId: task.id,
      instruction: instruction.toSnapshot(),
    });
    const primary = await prepareAgentWorkspace(
      this.workspaceManager,
      definition.primaryWorkspaceConfig,
      context,
      [task.projectId],
    );
    const secondary = [];

    for (const config of definition.secondaryWorkspaceConfigs) {
      secondary.push(
        await prepareAgentWorkspace(
          this.workspaceManager,
          config,
          context,
          [task.projectId],
        ),
      );
    }

    return Object.freeze({ primary, secondary: Object.freeze(secondary) });
  }

  private createPreparedRuntime(
    task: GenerationTaskSnapshot,
    definition: AnyTaskDefinition,
    instruction: GenerationInstruction,
    workspaces: PreparedAgentWorkspaces,
    assetReferences: PreparedGenerationTask['assetReferences'],
  ): PreparedGenerationTask {
    const context = {
      taskId: task.id,
      projectId: task.projectId,
      workspaces,
      assetReferences,
    };
    const preparedUserMessage = appendAssetReferencesToUserMessage(
      instruction.toUserMessage(context),
      assetReferences,
    );

    return Object.freeze({
      taskId: task.id,
      projectId: task.projectId,
      definitionId: task.definitionId,
      definitionVersion: task.definitionVersion,
      providerSelectorId: definition.providerSelectorId,
      instruction,
      preparedUserMessage,
      workspaces,
      assetReferences,
    });
  }
}
