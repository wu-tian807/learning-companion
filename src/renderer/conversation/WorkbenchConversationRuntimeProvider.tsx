import { useEffect, useMemo, type ReactNode } from 'react';

import { WorkbenchConversationRuntimeContext } from './workbench-conversation-context';
import { WorkbenchConversationRuntime } from './workbench-conversation-runtime';

export function WorkbenchConversationRuntimeProvider({
  runtime,
  children,
}: {
  readonly runtime?: WorkbenchConversationRuntime;
  readonly children: ReactNode;
}) {
  const ownedRuntime = useMemo(
    () => runtime ?? new WorkbenchConversationRuntime(),
    [runtime],
  );
  useEffect(() => () => {
    if (!runtime) ownedRuntime.dispose();
  }, [ownedRuntime, runtime]);
  return (
    <WorkbenchConversationRuntimeContext.Provider value={ownedRuntime}>
      {children}
    </WorkbenchConversationRuntimeContext.Provider>
  );
}
