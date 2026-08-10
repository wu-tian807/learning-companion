import type {
  AgentProviderSelectorSelectionSnapshot,
  AgentProviderSetupSnapshot,
} from '../../shared/agent-providers';

/**
 * 查找某个 (selector, connection) 已保存的模型配置。
 * 每个 Connection 各存一份，切换 Connection 时用各自的配置恢复。
 */
export function findSelectorConnectionSelection(
  setup: AgentProviderSetupSnapshot | undefined,
  selectorId: string,
  connectionId: string,
): AgentProviderSelectorSelectionSnapshot | undefined {
  return setup?.selections.find(
    (selection) =>
      selection.selectorId === selectorId &&
      selection.connectionId === connectionId,
  );
}
