import { AgentProviderRegistry } from '../agents/agent-provider-registry';
import { AgentProviderSelectorRegistry } from '../agents/agent-provider-selector-registry';
import type { AgentProviderSecretStore } from '../agents/agent-provider-secret-file';
import { AgentProviderService } from '../agents/agent-provider-service';
import {
  CODEX_ACCOUNT_CONNECTION_ID,
  CODEX_AGENT_PROVIDER_ID,
  CodexAgentProvider,
} from '../agents/providers/codex-agent-provider';
import type { CodexRuntimeServiceApi } from '../agents/codex/codex-runtime-service-api';
import type { AgentSessionServiceApi } from '../agents/sessions/agent-session-service';
import type { AgentFunctionToolRegistryApi } from '../agents/function-tools/agent-function-tool-registry';
import type { AgentMcpServiceApi } from '../agents/mcp/agent-mcp-service';
import type { AgentSkillServiceApi } from '../agents/skills/agent-skill-service';
import type { SettingsRepository } from '../settings/settings-repository';
import { GENERATION_CENTER_AGENT_PROVIDER_SELECTOR_ID } from '../../shared/agent-provider-selectors';
import { registerWorkbenchAgentProviderSelectors } from '../../workbenches/catalog/register-agent-provider-selectors';

export const GENERATION_CENTER_AGENT_PROVIDER_SELECTOR_DEFINITION =
  Object.freeze({
    id: GENERATION_CENTER_AGENT_PROVIDER_SELECTOR_ID,
    displayName: '生成中心',
    description: '生成思维导图、学习提纲等 Project 内容。',
    defaultSelection: Object.freeze({
      providerId: CODEX_AGENT_PROVIDER_ID,
      connectionId: CODEX_ACCOUNT_CONNECTION_ID,
      modelId: 'gpt-5.6-sol',
      reasoningEffort: 'high',
    }),
  });

export function createAgentProviderService(
  settings: SettingsRepository,
  secrets: AgentProviderSecretStore,
  codexRuntime: CodexRuntimeServiceApi,
  createCodexConnectionRuntime: (
    environment: Readonly<NodeJS.ProcessEnv>,
  ) => CodexRuntimeServiceApi,
  agentSessions: AgentSessionServiceApi,
  functionTools: AgentFunctionToolRegistryApi,
  skills: AgentSkillServiceApi,
  mcpServers: AgentMcpServiceApi,
): AgentProviderService {
  const registry = new AgentProviderRegistry();
  const selectors = new AgentProviderSelectorRegistry();
  selectors.register(GENERATION_CENTER_AGENT_PROVIDER_SELECTOR_DEFINITION);
  registerWorkbenchAgentProviderSelectors(selectors);
  registry.register(
    new CodexAgentProvider(codexRuntime, agentSessions, {
      functionTools,
      skills,
      mcpServers,
      createRuntime: createCodexConnectionRuntime,
    }),
  );

  return new AgentProviderService(settings, secrets, registry, selectors);
}
