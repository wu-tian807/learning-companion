import { CodexAppServerConnectionFactory } from '../agents/codex/codex-app-server-process';
import { CodexAuthConnectionFactory } from '../agents/codex/codex-auth-connection';
import { CodexAuthFileLink } from '../agents/codex/codex-auth-file-link';
import { resolveCodexExecutablePath } from '../agents/codex/codex-runtime-paths';
import { CodexRuntimeService } from '../agents/codex/codex-runtime-service';

export interface CreateCodexRuntimeInput {
  readonly codexHomePath: string;
  readonly authHomePath?: string | (() => Promise<string>);
  readonly isPackaged: boolean;
  readonly resourcesPath: string;
  readonly environment?: Readonly<NodeJS.ProcessEnv>;
}

export function createCodexRuntime({
  codexHomePath,
  authHomePath,
  isPackaged,
  resourcesPath,
  environment,
}: CreateCodexRuntimeInput): CodexRuntimeService {
  const executablePath = () => resolveCodexExecutablePath({ isPackaged, resourcesPath });
  const execution = new CodexAppServerConnectionFactory({
    codexHomePath,
    executablePath,
    credentialStore: 'file',
    ...(environment ? { environment } : {}),
  });
  return new CodexRuntimeService({
    async connect() {
      // Credential problems belong to provider setup, not application startup.
      const sourceHome = typeof authHomePath === 'function'
        ? await authHomePath() : authHomePath;
      if (!sourceHome || sourceHome === codexHomePath) return execution.connect();
      return new CodexAuthConnectionFactory(
        execution,
        new CodexAuthFileLink(codexHomePath, sourceHome),
      ).connect();
    },
  });
}
