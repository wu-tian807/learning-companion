import type { GenerationAgentTurnRequest } from '../../generation/generation-agent-runner';
import type { CodexRuntimeServiceApi } from '../codex/codex-runtime-service-api';
import type { CodexSkill } from '../codex/codex-runtime-types';
import { isRecord } from '../codex/codex-runtime-validation';

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

function configuredMcpServerNames(config: Readonly<Record<string, unknown>>) {
  const servers = config.mcp_servers;

  if (!isRecord(servers)) {
    return Object.freeze([]);
  }

  return Object.freeze(Object.keys(servers).sort());
}

export async function inspectCodexGenerationEnvironment(
  runtime: CodexRuntimeServiceApi,
  request: GenerationAgentTurnRequest,
): Promise<CodexGenerationEnvironment> {
  const [config, skillGroups] = await Promise.all([
    runtime.readConfig(),
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
    // mcpServerStatus/list also reports synthetic servers such as
    // codex_apps. They have no transport entry in config.toml, so writing a
    // partial `mcp_servers.<name> = { enabled = false }` session table makes
    // Codex reject thread/start with "invalid transport". Only configured
    // top-level servers can be safely overridden here; apps are disabled by
    // the separate apps/features session settings.
    disabledMcpServers: configuredMcpServerNames(config.config),
    disabledSkillPaths: Object.freeze([...disabledSkillPaths].sort()),
  });
}
