import type { ContextMenuParams } from 'electron';

import {
  CORE_CONTEXT_MENU_SURFACE_FACILITY_ID,
  CORE_FACILITY_VERSION,
  CORE_TEXT_SELECTION_MAX_LENGTH,
  coreContextMediaTypes,
  type CoreContextMediaType,
} from '../../../../shared/workbench/facilities/core-facilities';
import type {
  MainFacilityCaptureContext,
  MainWorkbenchFacilityAdapter,
} from '../main-facility-adapter-registry';

export const SANDBOX_CONTEXT_MENU_TRIGGER = 'sandbox.context-menu';

function isExternalHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);

    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.username.length === 0 &&
      url.password.length === 0
    );
  } catch {
    return false;
  }
}

function mediaType(
  value: ContextMenuParams['mediaType'],
): CoreContextMediaType {
  return coreContextMediaTypes.includes(
    value as CoreContextMediaType,
  )
    ? (value as CoreContextMediaType)
    : 'none';
}

export class SandboxContextMenuFacilityAdapter
  implements MainWorkbenchFacilityAdapter
{
  readonly facilityId = CORE_CONTEXT_MENU_SURFACE_FACILITY_ID;
  readonly facilityVersion = CORE_FACILITY_VERSION;
  readonly triggers = [SANDBOX_CONTEXT_MENU_TRIGGER] as const;

  capture(context: MainFacilityCaptureContext) {
    const params = context.source as ContextMenuParams | undefined;

    if (!params) {
      return undefined;
    }

    const selectionText = params.selectionText.slice(
      0,
      CORE_TEXT_SELECTION_MAX_LENGTH,
    );

    return {
      x: params.x,
      y: params.y,
      frameUrl: params.frameURL || context.frame.url || 'about:blank',
      ...(selectionText.trim() ? { selectionText } : {}),
      ...(isExternalHttpUrl(params.linkURL)
        ? { linkUrl: params.linkURL }
        : {}),
      mediaType: mediaType(params.mediaType),
      ...(isExternalHttpUrl(params.srcURL)
        ? { sourceUrl: params.srcURL }
        : {}),
    };
  }
}
