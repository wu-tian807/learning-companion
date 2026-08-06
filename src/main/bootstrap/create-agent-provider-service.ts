import { AgentProviderRegistry } from '../agents/agent-provider-registry';
import { AgentProviderService } from '../agents/agent-provider-service';
import { CodexAgentProvider } from '../agents/providers/codex-agent-provider';
import type { CodexRuntimeServiceApi } from '../agents/codex/codex-runtime-service-api';
import type { AgentSessionServiceApi } from '../agents/sessions/agent-session-service';
import type { SettingsRepository } from '../settings/settings-repository';

export function createAgentProviderService(
  settings: SettingsRepository,
  codexRuntime: CodexRuntimeServiceApi,
  agentSessions: AgentSessionServiceApi,
): AgentProviderService {
  const registry = new AgentProviderRegistry();
  registry.register(new CodexAgentProvider(codexRuntime, agentSessions));

  return new AgentProviderService(settings, registry);
}
