import type { AgentProviderConnectionKind } from '../../../shared/agent-providers';
import { AgentProviderAccountConnectionPanel } from './AgentProviderAccountConnectionPanel';
import { AgentProviderApiKeyConnectionPanel } from './AgentProviderApiKeyConnectionPanel';
import type { AgentProviderConnectionPanel } from './agent-provider-connection-panel';

export class AgentProviderConnectionPanelRegistry {
  private readonly panels = new Map<
    AgentProviderConnectionKind,
    AgentProviderConnectionPanel
  >();

  register(
    kind: AgentProviderConnectionKind,
    panel: AgentProviderConnectionPanel,
  ): void {
    if (this.panels.has(kind)) {
      throw new Error(`Agent Provider Connection 面板重复注册：${kind}`);
    }
    this.panels.set(kind, panel);
  }

  require(kind: AgentProviderConnectionKind): AgentProviderConnectionPanel {
    const panel = this.panels.get(kind);
    if (!panel) {
      throw new Error(`Agent Provider Connection 面板未注册：${kind}`);
    }
    return panel;
  }
}

export function createCoreAgentProviderConnectionPanelRegistry(): AgentProviderConnectionPanelRegistry {
  const registry = new AgentProviderConnectionPanelRegistry();
  registry.register('account', AgentProviderAccountConnectionPanel);
  registry.register('api-key', AgentProviderApiKeyConnectionPanel);
  return registry;
}

export const agentProviderConnectionPanelRegistry =
  createCoreAgentProviderConnectionPanelRegistry();
