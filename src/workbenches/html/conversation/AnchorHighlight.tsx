import { useEffect } from 'react';

import type {
  WorkbenchCommand,
  WorkbenchCommandResult,
} from '../../../shared/workbench/protocol';
import {
  htmlAnchorCommands,
  isHtmlAnchorCommandResult,
  type HtmlAnchorTarget,
} from '../anchor-commands';

type ExecuteCommand = (
  command: WorkbenchCommand,
) => Promise<WorkbenchCommandResult>;

export interface AnchorHighlightProps {
  readonly target: HtmlAnchorTarget | undefined;
  readonly revision: number;
  readonly reveal: boolean;
  /** 0 keeps the outline until the owning interaction clears it. */
  readonly durationMs: number;
  readonly executeCommand: ExecuteCommand;
  readonly onNotFound?: () => void;
  readonly onFound?: () => void;
  readonly onError?: (error: unknown) => void;
}

export function createAnchorHighlightCommand(
  target: HtmlAnchorTarget,
  revision: number,
  reveal: boolean,
  durationMs: number,
): WorkbenchCommand {
  return {
    type: htmlAnchorCommands.highlight,
    payload: { target, revision, reveal, durationMs },
  };
}

export function createAnchorClearCommand(
  target: HtmlAnchorTarget,
  revision: number,
): WorkbenchCommand {
  return {
    type: htmlAnchorCommands.clear,
    payload: { target, revision },
  };
}

/**
 * Controls the frame-owned outline. The component deliberately renders no
 * renderer-side box: resolving and positioning an HTML anchor belongs to the
 * sandbox document whose scrolling and layout can actually move it.
 */
export function AnchorHighlight({
  target,
  revision,
  reveal,
  durationMs,
  executeCommand,
  onNotFound,
  onFound,
  onError,
}: AnchorHighlightProps) {
  useEffect(() => {
    if (!target || revision <= 0) {
      return;
    }

    let active = true;
    void executeCommand(
      createAnchorHighlightCommand(
        target,
        revision,
        reveal,
        durationMs,
      ),
    ).then(
      (result) => {
        if (!active) {
          return;
        }
        if (!isHtmlAnchorCommandResult(result.payload)) {
          onError?.(new Error('HTML anchor command returned invalid data'));
        } else if (!result.payload.found) {
          onNotFound?.();
        } else {
          onFound?.();
        }
      },
      (error: unknown) => {
        if (active) {
          onError?.(error);
        }
      },
    );

    return () => {
      active = false;
      void executeCommand(createAnchorClearCommand(target, revision)).catch(
        () => undefined,
      );
    };
  }, [
    durationMs,
    executeCommand,
    onError,
    onNotFound,
    onFound,
    reveal,
    revision,
    target,
  ]);

  return null;
}
