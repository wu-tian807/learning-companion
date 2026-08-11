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
import type { GenerationPreparedManifestFileApi } from './generation-prepared-manifest-file';
import { GENERATION_PREPARED_MANIFEST_REF } from './generation-prepared-manifest-file';
import { appendAssetReferencesToUserMessage } from './generation-user-message-composer';
import type { PreparedGenerationTask } from './prepared-generation-task';

export { GENERATION_PREPARED_MANIFEST_REF } from './generation-prepared-manifest-file';

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

function cloneToolRequirements(definition: AnyTaskDefinition) {
  return Object.freeze(
    definition.toolRequirements.map((tool) => Object.freeze({ ...tool })),
  );
}

function cloneCapabilityRequirements<
  T extends { readonly id: string; readonly availability: 'required' | 'optional' },
>(requirements: readonly T[]): readonly T[] {
  return Object.freeze(
    requirements.map((requirement) => Object.freeze({ ...requirement }) as T),
  );
}

export class GenerationTaskPreparer implements GenerationTaskPreparerApi {
  constructor(
    private readonly workspaceManager: AgentWorkspaceManagerApi,
    private readonly assetReferencePreparer: GenerationAssetReferencePreparerApi,
    private readonly manifestFile: GenerationPreparedManifestFileApi,
  ) {}

  async prepare(
    task: GenerationTaskSnapshot,
    definition: AnyTaskDefinition,
    signal?: AbortSignal,
  ): Promise<PreparedGenerationTask> {
    signal?.throwIfAborted();
    validateDefinitionIdentity(task, definition);
    const instruction = parseInstruction(task, definition);
    const workspaces = await this.prepareWorkspaces(task, definition, instruction);
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
    await this.manifestFile.write(
      workspaces.primary.path,
      task,
      assetReferences,
    );

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
    const workspaces = await this.prepareWorkspaces(task, definition, instruction);
    const manifest = await this.manifestFile.read(
      workspaces.primary.path,
      task.prepared.manifestRef,
      task,
    );
    const assetReferences = await this.assetReferencePreparer.verify(
      workspaces.primary.path,
      definition.assetReferenceSchema,
      manifest.assetReferences,
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
    const primary = await prepareAgentWorkspace(
      this.workspaceManager,
      definition.primaryWorkspaceConfig,
      task.id,
      [task.projectId],
      definition.resolvePrimaryWorkspaceInstanceKey?.(instruction.toSnapshot()),
    );
    const secondary = [];

    for (const config of definition.secondaryWorkspaceConfigs) {
      secondary.push(
        await prepareAgentWorkspace(
          this.workspaceManager,
          config,
          task.id,
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
    const defaultUserMessage = appendAssetReferencesToUserMessage(
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
      systemInstruction: definition.systemInstruction,
      defaultUserMessage,
      toolRequirements: cloneToolRequirements(definition),
      skills: cloneCapabilityRequirements(definition.skills),
      mcpServers: cloneCapabilityRequirements(definition.mcpServers),
      workspaces,
      assetReferences,
      manifestRef: GENERATION_PREPARED_MANIFEST_REF,
    });
  }
}
