import {
  spawn,
  type ChildProcessByStdio,
} from 'node:child_process';
import { isAbsolute } from 'node:path';
import type { Readable } from 'node:stream';

import { AppError } from '../errors/app-error';
import {
  ExternalProcessTerminator,
  type ExternalProcessTerminatorApi,
} from './external-process-terminator';

export const DEFAULT_COMMAND_OUTPUT_LIMIT = 64 * 1024;
export const DEFAULT_COMMAND_TERMINATION_GRACE_MS = 5_000;

export interface ExternalCommandResult {
  readonly stdout: string;
  readonly stderr: string;
}

export interface ExternalCommandRequest {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly windowsVerbatimArguments?: boolean;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
  readonly outputLimit?: number;
  readonly onStdout?: (content: string) => void;
  readonly onStderr?: (content: string) => void;
}

export interface ExternalCommandRunnerApi {
  run(request: ExternalCommandRequest): Promise<ExternalCommandResult>;
}

function createAbortError(): DOMException {
  return new DOMException('External command cancelled', 'AbortError');
}

function requirePositiveInteger(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new AppError('DATA_INTEGRITY_ERROR');
  }

  return value;
}

function appendLimited(
  current: string,
  content: string,
  limit: number,
): string {
  if (current.length >= limit) {
    return current;
  }

  return `${current}${content}`.slice(0, limit);
}

type ControlledChildProcess =
  ChildProcessByStdio<null, Readable, Readable>;

export class ExternalCommandRunner
  implements ExternalCommandRunnerApi
{
  constructor(
    private readonly processTerminator:
      ExternalProcessTerminatorApi =
        new ExternalProcessTerminator(),
  ) {}

  run(request: ExternalCommandRequest): Promise<ExternalCommandResult> {
    if (
      !isAbsolute(request.command) ||
      request.args.some((argument) => typeof argument !== 'string')
    ) {
      return Promise.reject(new AppError('DATA_INTEGRITY_ERROR'));
    }

    if (request.signal?.aborted) {
      return Promise.reject(createAbortError());
    }

    const timeoutMs = requirePositiveInteger(request.timeoutMs);
    const outputLimit = requirePositiveInteger(
      request.outputLimit ?? DEFAULT_COMMAND_OUTPUT_LIMIT,
    );

    return new Promise((resolvePromise, rejectPromise) => {
      let settled = false;
      let stdout = '';
      let stderr = '';
      let child: ControlledChildProcess;
      let terminationError: unknown;
      let forceTerminationTimer: ReturnType<typeof setTimeout> | undefined;

      try {
        child = spawn(request.command, [...request.args], {
          cwd: request.cwd,
          env: request.env,
          shell: false,
          windowsHide: true,
          windowsVerbatimArguments:
            request.windowsVerbatimArguments ?? false,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (error) {
        rejectPromise(
          new AppError('EXTERNAL_LIBRARY_INSTALL_FAILED', {
            cause: error,
          }),
        );
        return;
      }

      const cleanup = () => {
        clearTimeout(timeout);
        if (forceTerminationTimer) {
          clearTimeout(forceTerminationTimer);
        }
        request.signal?.removeEventListener('abort', handleAbort);
      };
      const finish = (
        result:
          | { readonly ok: true }
          | {
              readonly ok: false;
              readonly error: unknown;
            },
      ) => {
        if (settled) {
          return;
        }

        settled = true;
        cleanup();

        if (result.ok) {
          resolvePromise(Object.freeze({ stdout, stderr }));
        } else {
          rejectPromise(result.error);
        }
      };
      const requestTermination = (error: unknown) => {
        if (terminationError !== undefined) {
          return;
        }

        terminationError = error;
        this.processTerminator.terminate(child, false);
        forceTerminationTimer = setTimeout(() => {
          this.processTerminator.terminate(child, true);
        }, DEFAULT_COMMAND_TERMINATION_GRACE_MS);
      };
      const handleAbort = () => {
        requestTermination(createAbortError());
      };
      const handleOutput = (
        content: string,
        stream: 'stdout' | 'stderr',
      ) => {
        try {
          if (stream === 'stdout') {
            stdout = appendLimited(stdout, content, outputLimit);
            request.onStdout?.(content);
          } else {
            stderr = appendLimited(stderr, content, outputLimit);
            request.onStderr?.(content);
          }
        } catch (error) {
          requestTermination(
            new AppError('EXTERNAL_LIBRARY_INSTALL_FAILED', { cause: error }),
          );
        }
      };
      const timeout = setTimeout(() => {
        requestTermination(
          new AppError('EXTERNAL_LIBRARY_INSTALL_FAILED', {
            cause: new Error(
              `External command timed out after ${timeoutMs}ms`,
            ),
          }),
        );
      }, timeoutMs);

      request.signal?.addEventListener('abort', handleAbort, {
        once: true,
      });
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (content: string) =>
        handleOutput(content, 'stdout'),
      );
      child.stderr.on('data', (content: string) =>
        handleOutput(content, 'stderr'),
      );
      if (request.signal?.aborted) {
        handleAbort();
      }
      child.once('error', (error) => {
        finish({
          ok: false,
          error:
            terminationError ??
            new AppError('EXTERNAL_LIBRARY_INSTALL_FAILED', {
              cause: error,
            }),
        });
      });
      child.once('close', (code, signal) => {
        if (terminationError !== undefined) {
          finish({ ok: false, error: terminationError });
          return;
        }

        if (code === 0) {
          finish({ ok: true });
          return;
        }

        finish({
          ok: false,
          error: new AppError('EXTERNAL_LIBRARY_INSTALL_FAILED', {
            cause: new Error(
              `External command exited with code ${String(code)} and signal ${String(signal)}\n${stderr}`,
            ),
          }),
        });
      });
    });
  }
}
