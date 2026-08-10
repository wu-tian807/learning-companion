import { CodexAppServerConnectionFactory } from '../agents/codex/codex-app-server-process';
import { resolveCodexExecutablePath } from '../agents/codex/codex-runtime-paths';
import { CodexRuntimeService } from '../agents/codex/codex-runtime-service';

export interface CreateCodexRuntimeInput {
  readonly codexHomePath: string;
  readonly isPackaged: boolean;
  readonly resourcesPath: string;
  readonly environment?: Readonly<NodeJS.ProcessEnv>;
}

export function createCodexRuntime({
  codexHomePath,
  isPackaged,
  resourcesPath,
  environment,
}: CreateCodexRuntimeInput): CodexRuntimeService {
  return new CodexRuntimeService(
    new CodexAppServerConnectionFactory({
      codexHomePath,
      executablePath: () =>
        resolveCodexExecutablePath({
          isPackaged,
          resourcesPath,
        }),
      ...(environment ? { environment } : {}),
    }),
  );
}
