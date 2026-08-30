import { useEffect } from 'react';

import type {
  WorkbenchCommand,
  WorkbenchCommandResult,
} from '../../../shared/workbench/protocol';
import type { HtmlAnchorTarget } from '../anchor-commands';
import {
  htmlEditIndicatorCommands,
  isHtmlEditIndicatorCommandResult,
} from '../html-edit-indicator-commands';

type ExecuteCommand = (
  command: WorkbenchCommand,
) => Promise<WorkbenchCommandResult>;

export interface HtmlEditIndicatorProps {
  readonly target: HtmlAnchorTarget | undefined;
  readonly revision: number;
  readonly phase: 'editing' | 'rejected';
  readonly executeCommand: ExecuteCommand;
  readonly onError?: (error: unknown) => void;
}

export function HtmlEditIndicator({
  target,
  revision,
  phase,
  executeCommand,
  onError,
}: HtmlEditIndicatorProps) {
  useEffect(() => {
    if (!target || revision <= 0) return;

    let active = true;
    void executeCommand({
      type: htmlEditIndicatorCommands.show,
      payload: { target, revision, phase },
    }).then(
      (result) => {
        if (
          active &&
          !isHtmlEditIndicatorCommandResult(result.payload)
        ) {
          onError?.(new Error('HTML edit indicator returned invalid data'));
        }
      },
      (error: unknown) => {
        if (active) onError?.(error);
      },
    );

    return () => {
      active = false;
      void executeCommand({
        type: htmlEditIndicatorCommands.clear,
        payload: { target, revision },
      }).catch(() => undefined);
    };
  }, [executeCommand, onError, phase, revision, target]);

  return null;
}
