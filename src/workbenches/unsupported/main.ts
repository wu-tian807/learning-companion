import { AppError } from '../../main/errors/app-error';
import type { MainWorkbenchProvider } from '../../main/workbench/workbench-session';
import type { WorkbenchCommandResult } from '../../shared/workbench/protocol';
import {
  createUnsupportedWorkbenchPayload,
  unsupportedWorkbenchManifest,
} from './shared';

export class UnsupportedWorkbenchProvider
  implements MainWorkbenchProvider
{
  readonly manifest = unsupportedWorkbenchManifest;

  async open(context: Parameters<MainWorkbenchProvider['open']>[0]) {
    if (context.selectionReason === 'matched') {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }

    return {
      payload: createUnsupportedWorkbenchPayload(context.selectionReason),
    };
  }

  async command(
    _context: Parameters<MainWorkbenchProvider['command']>[0],
    _command: Parameters<MainWorkbenchProvider['command']>[1],
  ): Promise<WorkbenchCommandResult> {
    void _context;
    void _command;
    throw new AppError('FEATURE_NOT_SUPPORTED');
  }

  async close(
    _context: Parameters<MainWorkbenchProvider['close']>[0],
  ): Promise<void> {
    void _context;
  }
}
