import type { AgentProviderConnectionSnapshot } from '../../../shared/agent-providers';

export function agentProviderConnectionStatusLabel(
  connection: AgentProviderConnectionSnapshot,
): string {
  if (connection.refreshing) {
    return '正在检查';
  }
  if (connection.status === 'ready') {
    return '可用';
  }
  if (connection.status === 'unavailable') {
    return '暂时不可用';
  }
  return '未配置';
}

export function agentProviderConnectionStatusClass(
  connection: AgentProviderConnectionSnapshot,
): string {
  if (connection.status === 'ready') {
    return 'bg-emerald-300/10 text-emerald-200';
  }
  if (connection.status === 'unavailable') {
    return 'bg-rose-300/10 text-rose-200';
  }
  return 'bg-white/[0.06] text-slate-400';
}
