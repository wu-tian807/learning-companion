import type { WorkbenchInvocationContext } from '../../../shared/workbench/interaction';

export type WorkbenchActionClosePolicy =
  | 'always'
  | 'on-success'
  | 'never';

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

export interface WorkbenchActionBundle {
  readonly actions: readonly WorkbenchAction[];
  readonly contributions: readonly import('./workbench-contribution').WorkbenchContribution[];
}
