import type { WebFrameMain } from 'electron';

import type { JsonValue } from '../../../shared/workbench/protocol';

export interface MainFacilityCaptureContext {
  readonly sessionId: string;
  readonly workbenchId: string;
  readonly trigger: string;
  readonly frame: WebFrameMain;
  readonly source?: unknown;
}

export interface MainWorkbenchFacilityAdapter {
  readonly workbenchId: string;
  readonly facilityId: string;
  readonly facilityVersion: number;
  readonly triggers: readonly string[];
  readonly dedupe?: boolean;
  capture(
    context: MainFacilityCaptureContext,
  ): JsonValue | undefined | Promise<JsonValue | undefined>;
}
