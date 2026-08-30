import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useSyncExternalStore,
} from 'react';

import type {
  WorkbenchConversationContribution,
} from './conversation-contracts';
import {
  WorkbenchConversationRuntime,
  type WorkbenchCurrentConversationState,
  type WorkbenchConversationScope,
} from './workbench-conversation-runtime';

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

export function useWorkbenchCurrentConversationState(
  runtime: WorkbenchConversationRuntime,
  scope: WorkbenchConversationScope,
): WorkbenchCurrentConversationState | undefined {
  const {
    assetId,
    contributionId,
    conversationPartitionKey,
    projectId,
  } = scope;
  const subscribe = useCallback(
    (listener: () => void) =>
      runtime.subscribeCurrentConversation(
        {
          assetId,
          contributionId,
          ...(conversationPartitionKey === undefined
            ? {}
            : { conversationPartitionKey }),
          projectId,
        },
        listener,
      ),
    [
      assetId,
      contributionId,
      conversationPartitionKey,
      projectId,
      runtime,
    ],
  );
  const getSnapshot = useCallback(
    () => runtime.getCurrentConversationState({
      assetId,
      contributionId,
      ...(conversationPartitionKey === undefined
        ? {}
        : { conversationPartitionKey }),
      projectId,
    }),
    [
      assetId,
      contributionId,
      conversationPartitionKey,
      projectId,
      runtime,
    ],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useWorkbenchConversationContribution(
  ownerId: string,
  contribution: WorkbenchConversationContribution,
): WorkbenchConversationRuntime {
  const runtime = useWorkbenchConversationRuntime();
  useEffect(
    () => runtime.register(ownerId, contribution),
    [contribution, ownerId, runtime],
  );
  return runtime;
}
