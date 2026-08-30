import {
  createContext,
  useContext,
  useEffect,
  useSyncExternalStore,
} from 'react';

import type { WorkbenchConversationContribution } from './conversation-contracts';
import { WorkbenchConversationRuntime } from './workbench-conversation-runtime';

export const WorkbenchConversationRuntimeContext =
  createContext<WorkbenchConversationRuntime | null>(null);

export function useWorkbenchConversationRuntime(): WorkbenchConversationRuntime {
  const runtime = useContext(WorkbenchConversationRuntimeContext);
  if (!runtime) {
    throw new Error('WorkbenchConversationRuntimeProvider 缺失');
  }
  return runtime;
}

export function useWorkbenchConversationSnapshot(
  providedRuntime?: WorkbenchConversationRuntime,
) {
  const contextualRuntime = useContext(WorkbenchConversationRuntimeContext);
  const runtime = providedRuntime ?? contextualRuntime;
  if (!runtime) {
    throw new Error('WorkbenchConversationRuntimeProvider 缺失');
  }
  return useSyncExternalStore(
    runtime.subscribe,
    runtime.getSnapshot,
    runtime.getSnapshot,
  );
}

export function useWorkbenchConversationContribution(
  ownerId: string,
  assetId: string,
  contribution: WorkbenchConversationContribution,
): WorkbenchConversationRuntime {
  const runtime = useWorkbenchConversationRuntime();
  useEffect(
    () => runtime.register(ownerId, assetId, contribution),
    [assetId, contribution, ownerId, runtime],
  );
  return runtime;
}
