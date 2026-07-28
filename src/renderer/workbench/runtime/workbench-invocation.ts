import type {
  WorkbenchInteractionSnapshot,
  WorkbenchInvocationContext,
  WorkbenchInvocationOrigin,
} from '../../../shared/workbench/interaction';
import { isWorkbenchActionEnabled } from '../actions/workbench-action';
import type { WorkbenchActionRegistry } from './workbench-action-registry';
import type {
  WorkbenchRuntimeIdentity,
  WorkbenchRuntimeStore,
} from './workbench-runtime-store';

export type WorkbenchActionInvocationResult =
  | 'executed'
  | 'busy'
  | 'disabled'
  | 'missing'
  | 'stale'
  | 'failed';

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) {
    return value;
  }

  Object.freeze(value);
  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
  return value;
}

export function createWorkbenchInvocationContext(
  identity: WorkbenchRuntimeIdentity,
  origin: WorkbenchInvocationOrigin,
  interaction: WorkbenchInteractionSnapshot,
): WorkbenchInvocationContext {
  return deepFreeze(
    structuredClone({
      ...identity,
      ...interaction,
      origin,
    }),
  );
}

export interface WorkbenchActionInvokerDependencies {
  readonly reportError: (error: unknown, fallback: string) => void;
}

export class WorkbenchActionInvoker {
  constructor(
    private readonly registry: WorkbenchActionRegistry,
    private readonly store: WorkbenchRuntimeStore,
    private readonly dependencies: WorkbenchActionInvokerDependencies,
  ) {}

  async invoke(
    actionId: string,
    invocation: WorkbenchInvocationContext,
  ): Promise<WorkbenchActionInvocationResult> {
    const state = this.store.getState();
    const identity = state.identity;

    if (
      !identity ||
      identity.projectId !== invocation.projectId ||
      identity.assetId !== invocation.assetId ||
      identity.workbenchId !== invocation.workbenchId ||
      identity.sessionId !== invocation.sessionId
    ) {
      return 'stale';
    }

    const action = this.registry.getAction(actionId);

    if (!action) {
      return 'missing';
    }
    if (!isWorkbenchActionEnabled(action)) {
      return 'disabled';
    }
    if (state.busyActionIds.has(actionId)) {
      return 'busy';
    }

    state.setActionBusy(actionId, true);
    try {
      await action.execute(invocation);
      return 'executed';
    } catch (error: unknown) {
      this.dependencies.reportError(
        error,
        '工作台操作失败，请重试。',
      );
      return 'failed';
    } finally {
      this.store.getState().setActionBusy(actionId, false);
    }
  }
}
