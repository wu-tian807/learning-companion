import type { ContentResourceServiceApi } from '../../main/content/content-resource-service';
import { AppError } from '../../main/errors/app-error';
import type { MainWorkbenchProvider } from '../../main/workbench/workbench-session';
import type { WorkbenchCommandResult } from '../../shared/workbench/protocol';
import {
  CORE_CONTEXT_MENU_SURFACE_FACILITY_ID,
  CORE_FACILITY_VERSION,
  CORE_SANDBOX_FRAME_TRANSPORT_FACILITY_ID,
  CORE_TEXT_SELECTION_INPUT_FACILITY_ID,
} from '../../shared/workbench/facilities/core-facilities';
import { htmlWorkbenchManifest } from './shared';

export class HtmlWorkbenchProvider implements MainWorkbenchProvider {
  readonly manifest = htmlWorkbenchManifest;
  private readonly sessions = new Set<string>();

  constructor(
    private readonly resourceService: ContentResourceServiceApi,
  ) {}

  async open(context: Parameters<MainWorkbenchProvider['open']>[0]) {
    const handle = context.content.handle;

    if (
      context.selectionReason !== 'matched' ||
      context.asset.mediaType !== 'text/html' ||
      !handle?.capabilities.has('read-stream') ||
      !handle.openByteStream
    ) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }
    if (this.sessions.has(context.sessionId)) {
      throw new AppError('REGISTRATION_CONFLICT');
    }

    const contentUrl = this.resourceService.register(
      context.sessionId,
      handle,
      'text/html',
    );
    this.sessions.add(context.sessionId);

    return {
      payload: { contentUrl },
      transportBindings: [
        {
          transportId:
            CORE_SANDBOX_FRAME_TRANSPORT_FACILITY_ID,
          transportVersion: CORE_FACILITY_VERSION,
          facilities: [
            {
              id: CORE_CONTEXT_MENU_SURFACE_FACILITY_ID,
              version: CORE_FACILITY_VERSION,
            },
            {
              id: CORE_TEXT_SELECTION_INPUT_FACILITY_ID,
              version: CORE_FACILITY_VERSION,
            },
          ],
          payload: { rootUrl: contentUrl },
        },
      ],
    };
  }

  async command(
    context: Parameters<MainWorkbenchProvider['command']>[0],
    _command: Parameters<MainWorkbenchProvider['command']>[1],
  ): Promise<WorkbenchCommandResult> {
    void _command;

    if (!this.sessions.has(context.sessionId)) {
      throw new AppError('WORKBENCH_SESSION_NOT_FOUND');
    }

    throw new AppError('FEATURE_NOT_SUPPORTED');
  }

  async close(
    context: Parameters<MainWorkbenchProvider['close']>[0],
  ): Promise<void> {
    if (this.sessions.delete(context.sessionId)) {
      this.resourceService.revokeSession(context.sessionId);
    }
  }
}
