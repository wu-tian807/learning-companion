import {
  spawn,
  type ChildProcess,
  type SpawnOptions,
} from 'node:child_process';
import { win32 } from 'node:path';

export interface ProcessTreeTerminatorApi {
  terminate(child: ChildProcess, force: boolean): void;
}

export interface ProcessTreeTerminatorDependencies {
  readonly platform: NodeJS.Platform;
  readonly environment: NodeJS.ProcessEnv;
  readonly spawnProcess: (
    command: string,
    args: readonly string[],
    options: SpawnOptions,
  ) => ChildProcess;
}

function isRunning(child: ChildProcess): boolean {
  return child.exitCode === null && child.signalCode === null;
}

function terminateDirectly(child: ChildProcess, force: boolean): void {
  if (!isRunning(child)) {
    return;
  }

  child.kill(force ? 'SIGKILL' : 'SIGTERM');
}

export class ProcessTreeTerminator
  implements ProcessTreeTerminatorApi
{
  private readonly dependencies: ProcessTreeTerminatorDependencies;

  constructor(
    dependencies: Partial<ProcessTreeTerminatorDependencies> = {},
  ) {
    this.dependencies = {
      platform: dependencies.platform ?? process.platform,
      environment: dependencies.environment ?? process.env,
      spawnProcess:
        dependencies.spawnProcess ??
        ((command, args, options) =>
          spawn(command, [...args], options)),
    };
  }

  terminate(child: ChildProcess, force: boolean): void {
    if (!isRunning(child)) {
      return;
    }

    if (this.dependencies.platform !== 'win32') {
      terminateDirectly(child, force);
      return;
    }

    this.terminateWindowsProcessTree(child);
  }

  private terminateWindowsProcessTree(child: ChildProcess): void {
    const processId = child.pid;
    const systemRoot =
      this.dependencies.environment.SystemRoot?.trim() ||
      this.dependencies.environment.WINDIR?.trim();

    if (
      processId === undefined ||
      !Number.isSafeInteger(processId) ||
      processId <= 0 ||
      !systemRoot ||
      !win32.isAbsolute(systemRoot)
    ) {
      terminateDirectly(child, true);
      return;
    }

    const taskkillPath = win32.join(
      systemRoot,
      'System32',
      'taskkill.exe',
    );
    let fallbackRequested = false;
    const fallback = () => {
      if (fallbackRequested) {
        return;
      }

      fallbackRequested = true;
      terminateDirectly(child, true);
    };

    try {
      const taskkill = this.dependencies.spawnProcess(
        taskkillPath,
        ['/PID', String(processId), '/T', '/F'],
        {
          shell: false,
          windowsHide: true,
          stdio: 'ignore',
        },
      );
      taskkill.once('error', fallback);
      taskkill.once('close', (code) => {
        if (code !== 0 && isRunning(child)) {
          fallback();
        }
      });
    } catch {
      fallback();
    }
  }
}
