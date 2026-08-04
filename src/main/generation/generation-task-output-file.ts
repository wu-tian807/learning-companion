import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import writeFileAtomic from 'write-file-atomic';

import {
  cloneJsonValue,
  isJsonValue,
  type JsonValue,
} from '../../shared/workbench/protocol';
import { AppError } from '../errors/app-error';
import type { GenerationTaskSnapshot } from './generation-task';
import type { PreparedGenerationTask } from './preparation/prepared-generation-task';

export const GENERATION_AGENT_OUTPUT_REF = 'control/agent-output.json';

export interface GenerationTaskOutputFileApi {
  write(
    prepared: PreparedGenerationTask,
    output: JsonValue,
  ): Promise<string>;
  read(
    snapshot: GenerationTaskSnapshot,
    prepared: PreparedGenerationTask,
  ): Promise<JsonValue>;
}

interface GenerationTaskOutputFileDependencies {
  readonly readFile: typeof readFile;
  readonly writeFileAtomic: typeof writeFileAtomic;
}

const defaultDependencies: GenerationTaskOutputFileDependencies = {
  readFile,
  writeFileAtomic,
};

function absoluteWorkspacePath(
  workspacePath: string,
  relativePath: string,
): string {
  return join(workspacePath, ...relativePath.split('/'));
}

export class GenerationTaskOutputFile
  implements GenerationTaskOutputFileApi
{
  private readonly dependencies: GenerationTaskOutputFileDependencies;

  constructor(
    dependencies: Partial<GenerationTaskOutputFileDependencies> = {},
  ) {
    this.dependencies = { ...defaultDependencies, ...dependencies };
  }

  async write(
    prepared: PreparedGenerationTask,
    output: JsonValue,
  ): Promise<string> {
    await this.dependencies.writeFileAtomic(
      absoluteWorkspacePath(
        prepared.workspaces.primary.path,
        GENERATION_AGENT_OUTPUT_REF,
      ),
      `${JSON.stringify(output, undefined, 2)}\n`,
      { encoding: 'utf8' },
    );
    return GENERATION_AGENT_OUTPUT_REF;
  }

  async read(
    snapshot: GenerationTaskSnapshot,
    prepared: PreparedGenerationTask,
  ): Promise<JsonValue> {
    if (!snapshot.agentCompleted) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }

    const value: unknown = JSON.parse(
      await this.dependencies.readFile(
        absoluteWorkspacePath(
          prepared.workspaces.primary.path,
          snapshot.agentCompleted.outputRef,
        ),
        'utf8',
      ),
    );

    if (!isJsonValue(value)) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }

    return cloneJsonValue(value);
  }
}
