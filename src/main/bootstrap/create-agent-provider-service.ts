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
import {
  HIGH_INTELLIGENCE_AGENT_PROVIDER_SELECTOR_ID,
  LOW_INTELLIGENCE_AGENT_PROVIDER_SELECTOR_ID,
  MEDIUM_INTELLIGENCE_AGENT_PROVIDER_SELECTOR_ID,
} from '../../shared/agent-provider-selectors';
import type { AgentProviderSelectorDefinition } from '../agents/agent-provider-selector-registry';

export const DEFAULT_AGENT_PROVIDER_SELECTOR_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: HIGH_INTELLIGENCE_AGENT_PROVIDER_SELECTOR_ID,
    displayName: '高智能',
    description: '复杂内容生成、全局规划与高难度推理。',
    defaultSelection: Object.freeze({
      providerId: CODEX_AGENT_PROVIDER_ID,
      connectionId: CODEX_ACCOUNT_CONNECTION_ID,
      modelId: 'gpt-5.6-sol',
      reasoningEffort: 'high',
    }),
  }),
  Object.freeze({
    id: MEDIUM_INTELLIGENCE_AGENT_PROVIDER_SELECTOR_ID,
    displayName: '中智能',
    description: '工作台解释、问答与常规内容处理。',
    defaultSelection: Object.freeze({
      providerId: CODEX_AGENT_PROVIDER_ID,
      connectionId: CODEX_ACCOUNT_CONNECTION_ID,
      modelId: 'gpt-5.6-terra',
      reasoningEffort: 'medium',
    }),
  }),
  Object.freeze({
    id: LOW_INTELLIGENCE_AGENT_PROVIDER_SELECTOR_ID,
    displayName: '低智能',
    description: '字幕翻译等高频、结构明确的任务。',
    defaultSelection: Object.freeze({
      providerId: CODEX_AGENT_PROVIDER_ID,
      connectionId: CODEX_ACCOUNT_CONNECTION_ID,
      modelId: 'gpt-5.6-luna',
      reasoningEffort: 'low',
    }),
  }),
]) satisfies readonly AgentProviderSelectorDefinition[];

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
  for (const definition of DEFAULT_AGENT_PROVIDER_SELECTOR_DEFINITIONS) {
    selectors.register(definition);
  }
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
