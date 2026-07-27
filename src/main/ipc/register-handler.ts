import { ipcMain, type IpcMainInvokeEvent } from 'electron';

import type { IpcResult } from '../../shared/ipc-error';
import { handleAppError } from '../errors/app-error';

type IpcHandler<Response> = (
  event: IpcMainInvokeEvent,
  ...args: unknown[]
) => Response | Promise<Response>;

export function registerIpcHandler<Response>(
  channel: string,
  handler: IpcHandler<Response>,
): void {
  ipcMain.handle(
    channel,
    async (event, ...args): Promise<IpcResult<Response>> => {
      try {
        return {
          ok: true,
          data: await handler(event, ...args),
        };
      } catch (error) {
        return {
          ok: false,
          error: handleAppError(channel, error),
        };
      }
    },
  );
}
