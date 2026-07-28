import { useEffect } from 'react';

import type { WorkbenchActionBundle } from '../actions/workbench-action';
import { useWorkbenchRuntime } from './workbench-runtime-context';

export function useWorkbenchContributions(
  ownerId: string,
  bundle: WorkbenchActionBundle,
): void {
  const runtime = useWorkbenchRuntime();

  useEffect(
    () => runtime.registerContributions(ownerId, bundle),
    [bundle, ownerId, runtime],
  );
}
