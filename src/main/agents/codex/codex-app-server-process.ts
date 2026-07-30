import {
  spawn,
  type ChildProcessByStdio,
  type SpawnOptions,
} from 'node:child_process';
import { constants } from 'node:fs';
import { access, mkdir } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import type { Readable, Writable } from 'node:stream';

import { ProcessTreeTerminator } from '../../processes/process-tree-terminator';
import {
  CodexJsonRpcConnection,
  type CodexRpcConnectionApi,
  type CodexProcessTerminatorApi,
} from './codex-rpc-connection';

type SpawnedCodexProcess = ChildProcessByStdio<
  Writable,
  Readable,
  Readable
>;

export interface CodexAppServerConnectionFactoryApi {
  connect(): Promise<CodexRpcConnectionApi>;
}

export interface CodexAppServerProcessDependencies {
  readonly environment: NodeJS.ProcessEnv;
  readonly spawnProcess: (
    command: string,
    args: readonly string[],
    options: SpawnOptions,
  ) => SpawnedCodexProcess;
  readonly terminator: CodexProcessTerminatorApi;
}

export interface CodexAppServerProcessOptions {
  readonly executablePath: string | (() => string);
  readonly codexHomePath: string;
}

const AUTH_ENVIRONMENT_VARIABLES = [
  'AZURE_OPENAI_API_KEY',
  'CODEX_API_KEY',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
] as const;

function createIsolatedEnvironment(
  source: NodeJS.ProcessEnv,
  codexHomePath: string,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    ...source,
    CODEX_HOME: codexHomePath,
  };

  for (const name of AUTH_ENVIRONMENT_VARIABLES) {
    delete environment[name];
  }

  return environment;
}

export class CodexAppServerConnectionFactory
  implements CodexAppServerConnectionFactoryApi
{
  private readonly dependencies: CodexAppServerProcessDependencies;

  constructor(
    private readonly options: CodexAppServerProcessOptions,
    dependencies: Partial<CodexAppServerProcessDependencies> = {},
  ) {
    if (
      (typeof options.executablePath === 'string' &&
        !isAbsolute(options.executablePath)) ||
      !isAbsolute(options.codexHomePath)
    ) {
      throw new Error('Codex Runtime 路径必须是绝对路径');
    }

    this.dependencies = {
      environment: dependencies.environment ?? process.env,
      spawnProcess:
        dependencies.spawnProcess ??
        ((command, args, spawnOptions) =>
          spawn(command, [...args], spawnOptions) as SpawnedCodexProcess),
      terminator:
        dependencies.terminator ?? new ProcessTreeTerminator(),
    };
  }

  async connect(): Promise<CodexRpcConnectionApi> {
    const executablePath =
      typeof this.options.executablePath === 'string'
        ? this.options.executablePath
        : this.options.executablePath();

    if (!isAbsolute(executablePath)) {
      throw new Error('Codex Runtime 路径必须是绝对路径');
    }

    await Promise.all([
      mkdir(this.options.codexHomePath, { recursive: true }),
      access(executablePath, constants.X_OK),
    ]);

    const child = this.dependencies.spawnProcess(
      executablePath,
      ['app-server', '--listen', 'stdio://'],
      {
        cwd: this.options.codexHomePath,
        env: createIsolatedEnvironment(
          this.dependencies.environment,
          this.options.codexHomePath,
        ),
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );

    return new CodexJsonRpcConnection(
      child,
      this.dependencies.terminator,
    );
  }
}
