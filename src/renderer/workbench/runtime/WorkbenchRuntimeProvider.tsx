import {
  type ReactNode,
  useEffect,
  useState,
} from 'react';

import { userMessageFromError } from '../../../shared/ipc-error';
import {
  WorkbenchRuntime,
  type WorkbenchErrorReporter,
} from './workbench-runtime';
import { WorkbenchRuntimeContext } from './workbench-runtime-context';

export interface WorkbenchRuntimeProviderProps {
  readonly children: ReactNode;
  readonly onError: (message: string) => void;
}

export function WorkbenchRuntimeProvider({
  children,
  onError,
}: WorkbenchRuntimeProviderProps) {
  const [runtime] = useState(() => {
    const reportError: WorkbenchErrorReporter = (error, fallback) => {
      const message = userMessageFromError(error, fallback);

      if (message) {
        console.error(message, error);
        onError(message);
      }
    };
    return new WorkbenchRuntime(reportError);
  });

  useEffect(() => {
    runtime.setErrorReporter((error, fallback) => {
      const message = userMessageFromError(error, fallback);

      if (message) {
        console.error(message, error);
        onError(message);
      }
    });
  }, [onError, runtime]);

  useEffect(
    () => () => {
      runtime.deactivate();
    },
    [runtime],
  );

  return (
    <WorkbenchRuntimeContext.Provider value={runtime}>
      {children}
    </WorkbenchRuntimeContext.Provider>
  );
}
