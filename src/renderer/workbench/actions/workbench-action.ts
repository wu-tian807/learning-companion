import type { WorkbenchInvocationContext } from '../../../shared/workbench/interaction';

export interface WorkbenchAction {
  readonly id: string;
  readonly enabled: boolean | (() => boolean);
  readonly execute: (
    context: WorkbenchInvocationContext,
  ) => Promise<void> | void;
}

export function isWorkbenchActionEnabled(
  action: WorkbenchAction,
): boolean {
  return typeof action.enabled === 'function'
    ? action.enabled()
    : action.enabled;
}
