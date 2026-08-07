import { AgentProviderRegistry } from '../agents/agent-provider-registry';
import { AgentProviderService } from '../agents/agent-provider-service';
import { CodexAgentProvider } from '../agents/providers/codex-agent-provider';
import type { CodexRuntimeServiceApi } from '../agents/codex/codex-runtime-service-api';
import type { AgentSessionServiceApi } from '../agents/sessions/agent-session-service';
import type { AgentFunctionToolRegistryApi } from '../agents/function-tools/agent-function-tool-registry';
import type { AgentMcpServiceApi } from '../agents/mcp/agent-mcp-service';
import type { AgentSkillServiceApi } from '../agents/skills/agent-skill-service';
import type { AgentToolRequirement } from '../generation/contracts/task-definition';
import type { SettingsRepository } from '../settings/settings-repository';

export function createAgentProviderService(
  settings: SettingsRepository,
  codexRuntime: CodexRuntimeServiceApi,
  agentSessions: AgentSessionServiceApi,
  functionTools: AgentFunctionToolRegistryApi,
  skills: AgentSkillServiceApi,
  mcpServers: AgentMcpServiceApi,
  codexDefaultTools: readonly AgentToolRequirement[] = [],
): AgentProviderService {
  const registry = new AgentProviderRegistry();
  registry.register(
    new CodexAgentProvider(codexRuntime, agentSessions, {
      functionTools,
      skills,
      mcpServers,
      defaultTools: codexDefaultTools,
    }),
  );

  return new AgentProviderService(settings, registry);
}
