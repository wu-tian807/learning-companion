import { AppError } from '../../errors/app-error';
import type { GenerationAgentTurnRequest } from '../../generation/generation-agent-runner';
import type { CodexRuntimeServiceApi } from '../codex/codex-runtime-service-api';
import type {
  CodexMcpServer,
  CodexSkill,
} from '../codex/codex-runtime-types';

export interface CodexGenerationEnvironment {
  readonly disabledMcpServers: readonly string[];
  readonly disabledSkillPaths: readonly string[];
}

function optionalText(value: string | null | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function allWorkspacePaths(
  request: GenerationAgentTurnRequest,
): readonly string[] {
  return Object.freeze(
    [request.workspaces.primary, ...request.workspaces.secondary]
      .map(({ path }) => path)
      .sort((left, right) => left.localeCompare(right)),
  );
}

async function listCodexMcpServerNames(
  runtime: CodexRuntimeServiceApi,
): Promise<readonly string[]> {
  const names = new Set<string>();
  const cursors = new Set<string>();
  let cursor: string | undefined;

  do {
    const page = await runtime.listMcpServers({
      ...(cursor ? { cursor } : {}),
      limit: 100,
      detail: 'toolsAndAuthOnly',
    });

    for (const server of page.data as readonly CodexMcpServer[]) {
      const name = optionalText(server.name);

      if (name) {
        names.add(name);
      }
    }

    const nextCursor = page.nextCursor ?? undefined;

    if (nextCursor && cursors.has(nextCursor)) {
      throw new AppError('CODEX_PROTOCOL_ERROR');
    }

    if (nextCursor) {
      cursors.add(nextCursor);
    }
    cursor = nextCursor;
  } while (cursor);

  return Object.freeze([...names].sort());
}

export async function inspectCodexGenerationEnvironment(
  runtime: CodexRuntimeServiceApi,
  request: GenerationAgentTurnRequest,
): Promise<CodexGenerationEnvironment> {
  const [disabledMcpServers, skillGroups] = await Promise.all([
    listCodexMcpServerNames(runtime),
    runtime.listSkills(allWorkspacePaths(request), true),
  ]);
  const disabledSkillPaths = new Set<string>();

  for (const group of skillGroups) {
    for (const skill of group.skills as readonly CodexSkill[]) {
      const path = optionalText(skill.path);

      if (path) {
        disabledSkillPaths.add(path);
      }
    }
  }

  return Object.freeze({
    disabledMcpServers,
    disabledSkillPaths: Object.freeze([...disabledSkillPaths].sort()),
  });
}
